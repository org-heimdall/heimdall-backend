import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebatesService } from '../debates/debates.service';
import { DraftAppendResult, TurnFinalizeResult } from './debate-chat-state';
import { DEBATE_CHAT_STATE_STORE } from './debate-chat-state.store';
import type { DebateChatStateStore } from './debate-chat-state.store';
import {
  DebateTurnFinalizeDto,
  DebateTurnMessageSendDto,
} from './debate-chat.dto';
import { DebateChatPublisher } from './debate-chat.publisher';
import {
  ConnectionRestoredPayload,
  DebateChatTurn,
  DebateEndReason,
  DebateStatus,
} from './debate-chat.types';
import { DEBATE_PROCESSING_PIPELINE } from './debate-processing-pipeline';
import type { DebateProcessingPipeline } from './debate-processing-pipeline';
import { DebateTurnTimeoutScheduler } from './debate-turn-timeout.scheduler';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

// 만료 처리가 다른 명령과 겹쳐 락을 잡지 못했을 때 다시 시도하기까지의 간격.
export const EXPIRE_RETRY_DELAY_MS = 1000;

/**
 * 토론 채팅 응용 서비스. 상태 변경은 저장소의 withState 안에서만 일어나고, 차례가 바뀔 수 있는
 * 작업 뒤에는 다음 차례의 만료 시각으로 턴 타이머를 다시 건다.
 * 방 전체 이벤트(finalized/ended)는 여기서 발행하고, 송신자 제외가 필요한 created와 요청 소켓 대상 ack는
 * 소켓을 아는 게이트웨이/컨트롤러가 보낸다.
 */
@Injectable()
export class DebateChatService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DebateChatService.name);

  constructor(
    @Inject(DEBATE_CHAT_STATE_STORE)
    private readonly store: DebateChatStateStore,
    private readonly publisher: DebateChatPublisher,
    @Inject(DEBATE_PROCESSING_PIPELINE)
    private readonly pipeline: DebateProcessingPipeline,
    private readonly timeouts: DebateTurnTimeoutScheduler,
    private readonly debatesService: DebatesService,
  ) {
    // 타이머가 도메인을 모르도록 만료 시 실행할 동작을 여기서 걸어 준다.
    this.timeouts.register((debateId) => this.expireTurn(debateId));
  }

  // 재시작 복구: 진행 중이던 토론의 턴 타이머를 다시 건다. 이미 지난 만료는 곧바로 처리된다.
  async onApplicationBootstrap(): Promise<void> {
    let debateIds: string[];
    try {
      debateIds = await this.debatesService.findInProgressIds();
    } catch (error: unknown) {
      // 복구 실패로 부팅을 막지는 않는다. 다음 접속이 타이머를 다시 건다.
      this.logger.error('진행 중 토론 타이머 복구 실패', this.describe(error));
      return;
    }

    for (const debateId of debateIds) {
      await this.expireTurn(debateId);
    }
    if (debateIds.length > 0) {
      this.logger.log(`진행 중 토론 ${debateIds.length}건의 턴 타이머 복구`);
    }
  }

  // 접속·재접속 시 현재 상태 전체(현재 턴, 확정 턴, draft). 첫 접근이면 저장소가 토론을 시작시킨다(P2-3).
  async restore(debateId: string): Promise<ConnectionRestoredPayload> {
    const { payload, deadline } = await this.store.withState(
      debateId,
      (state) => ({
        payload: { debateId, ...state.snapshot() },
        deadline: state.currentTurnDeadline(),
      }),
    );

    this.timeouts.arm(debateId, deadline);
    return payload;
  }

  // draft 추가. APPENDED/DUPLICATE 판정과 저장된 메시지를 돌려준다(차례는 바뀌지 않는다).
  async appendDraft(
    debateId: string,
    memberId: string,
    payload: DebateTurnMessageSendDto,
    clientMessageId?: string,
  ): Promise<DraftAppendResult> {
    return this.store.withState(debateId, (state) =>
      state.appendDraft(memberId, payload, clientMessageId),
    );
  }

  // 차례 확정. 방 전체에 finalized를 알리고, 마지막 차례였으면 ended까지 알린 뒤 처리 파이프라인을 띄운다.
  async finalizeTurn(
    debateId: string,
    memberId: string,
    payload: DebateTurnFinalizeDto,
  ): Promise<DebateChatTurn> {
    const { result, communityId, status, deadline } =
      await this.store.withState(debateId, (state) => ({
        result: state.finalizeTurn(memberId, payload),
        communityId: state.communityId,
        status: state.currentStatus,
        deadline: state.currentTurnDeadline(),
      }));

    this.timeouts.arm(debateId, deadline);
    this.announceTurn(debateId, communityId, status, result);
    return result.turn;
  }

  /**
   * 턴 타이머가 만료 시각에 부른다. 실제로 시간이 지났는지는 락 안에서 상태가 판단하며,
   * 지났으면 그때까지 쓴 draft를 확정하고 상대에게 차례를 넘긴다(P2-4).
   * 그 사이 발언자가 직접 확정했다면 아무 일도 일어나지 않고 새 만료 시각으로 타이머만 다시 걸린다.
   */
  async expireTurn(debateId: string): Promise<void> {
    try {
      const { result, communityId, status, deadline } =
        await this.store.withState(debateId, (state) => ({
          result: state.expireTurn(),
          communityId: state.communityId,
          status: state.currentStatus,
          deadline: state.currentTurnDeadline(),
        }));

      this.timeouts.arm(debateId, deadline);
      if (result === null) {
        return;
      }
      this.logger.log(
        `턴 시간 초과로 차례를 넘김: debateId=${debateId}, sequence=${result.turn.sequence}`,
      );
      this.announceTurn(debateId, communityId, status, result);
    } catch (error: unknown) {
      if (this.isLockContention(error)) {
        // 다른 명령을 처리 중이었다. 잠시 뒤 같은 판정을 다시 시도한다.
        this.timeouts.arm(
          debateId,
          new Date(Date.now() + EXPIRE_RETRY_DELAY_MS),
        );
        return;
      }
      this.logger.error(
        `턴 시간 초과 처리 실패: debateId=${debateId}`,
        this.describe(error),
      );
    }
  }

  // 확정된 턴을 방에 알리고, 마지막 차례였으면 종료까지 알린 뒤 처리 파이프라인을 띄운다.
  // 직접 확정이든 시간 초과든 확정 이후는 같다.
  private announceTurn(
    debateId: string,
    communityId: string,
    status: DebateStatus,
    { turn, ended }: TurnFinalizeResult,
  ): void {
    this.publisher.turnFinalized(debateId, turn);
    if (!ended) {
      return;
    }
    this.publisher.debateEnded({
      communityId,
      debateId,
      status,
      reason: DebateEndReason.ALL_TURNS_FINALIZED,
    });
    this.startProcessing(debateId);
  }

  // 처리 파이프라인은 백그라운드. 실패해도 finalize 응답에는 영향을 주지 않고 로그만 남긴다.
  private startProcessing(debateId: string): void {
    this.pipeline.start(debateId).catch((error: unknown) => {
      this.logger.error(
        `토론 처리 파이프라인 실패: debateId=${debateId}`,
        this.describe(error),
      );
    });
  }

  private isLockContention(error: unknown): boolean {
    return (
      error instanceof GeneralException &&
      error.appError.code === DebateChatErrorCode.FINALIZE_IN_PROGRESS.code
    );
  }

  private describe(error: unknown): string {
    return error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  }
}
