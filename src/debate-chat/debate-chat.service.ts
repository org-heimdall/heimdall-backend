import { Inject, Injectable, Logger } from '@nestjs/common';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebatesService } from '../debates/debates.service';
import { Debate } from '../debates/entities/debate.entity';
import {
  DebateChatState,
  DebateSpeakers,
  DebateTurnSchedule,
  DraftAppendResult,
} from './debate-chat-state';
import { DEBATE_CHAT_STATE_STORE } from './debate-chat-state.store';
import type { DebateChatStateStore } from './debate-chat-state.store';
import { DebateChatConfig } from './debate-chat.config';
import {
  DebateTurnFinalizeDto,
  DebateTurnMessageSendDto,
} from './debate-chat.dto';
import { DebateChatPublisher } from './debate-chat.publisher';
import {
  ConnectionRestoredPayload,
  DebateChatTurn,
  DebateEndReason,
  DebateSide,
} from './debate-chat.types';
import { DEBATE_PROCESSING_PIPELINE } from './debate-processing-pipeline';
import type { DebateProcessingPipeline } from './debate-processing-pipeline';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

/**
 * 토론 채팅 응용 서비스. 상태 변경은 저장소의 withState 안에서만 일어난다.
 * 방 전체 이벤트(finalized/ended)는 여기서 발행하고, 송신자 제외가 필요한 created와 요청 소켓 대상 ack는
 * 소켓을 아는 게이트웨이가 보낸다.
 */
@Injectable()
export class DebateChatService {
  private readonly logger = new Logger(DebateChatService.name);

  constructor(
    private readonly debatesService: DebatesService,
    @Inject(DEBATE_CHAT_STATE_STORE)
    private readonly store: DebateChatStateStore,
    private readonly publisher: DebateChatPublisher,
    @Inject(DEBATE_PROCESSING_PIPELINE)
    private readonly pipeline: DebateProcessingPipeline,
    private readonly config: DebateChatConfig,
  ) {}

  // 접속·재접속 시 현재 상태 전체(현재 턴, 확정 턴, draft).
  async restore(debateId: string): Promise<ConnectionRestoredPayload> {
    return this.store.withState(
      debateId,
      () => this.initialize(debateId),
      (state) => ({ debateId, ...state.snapshot() }),
    );
  }

  // draft 추가. APPENDED/DUPLICATE 판정과 저장된 메시지를 돌려준다.
  async appendDraft(
    debateId: string,
    memberId: string,
    payload: DebateTurnMessageSendDto,
    clientMessageId?: string,
  ): Promise<DraftAppendResult> {
    return this.store.withState(
      debateId,
      () => this.initialize(debateId),
      (state) => state.appendDraft(memberId, payload, clientMessageId),
    );
  }

  // 차례 확정. 방 전체에 finalized를 알리고, 마지막 차례였으면 ended까지 알린 뒤 처리 파이프라인을 띄운다.
  async finalizeTurn(
    debateId: string,
    memberId: string,
    payload: DebateTurnFinalizeDto,
  ): Promise<DebateChatTurn> {
    const { turn, ended, communityId, status } = await this.store.withState(
      debateId,
      () => this.initialize(debateId),
      (state) => ({
        ...state.finalizeTurn(memberId, payload),
        communityId: state.communityId,
        status: state.currentStatus,
      }),
    );

    this.publisher.turnFinalized(debateId, turn);
    if (ended) {
      this.publisher.debateEnded({
        communityId,
        debateId,
        status,
        reason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
      this.startProcessing(debateId);
    }
    return turn;
  }

  // 처리 파이프라인은 백그라운드. 실패해도 finalize 응답에는 영향을 주지 않고 로그만 남긴다.
  private startProcessing(debateId: string): void {
    this.pipeline.start(debateId).catch((error: unknown) => {
      this.logger.error(
        `토론 처리 파이프라인 실패: debateId=${debateId}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  // 첫 접근 시 토론을 읽어 채팅 상태를 만든다. 라운드 수는 커뮤니티의 debateRoundCount.
  private async initialize(debateId: string): Promise<DebateChatState> {
    const debate = await this.debatesService.findOneOrThrow(debateId);
    return new DebateChatState({
      debateId: debate.id,
      communityId: debate.communityId,
      speakers: this.toSpeakers(debate),
      schedule: new DebateTurnSchedule(debate.community.debateRoundCount),
      limits: this.config.limits,
    });
  }

  // 기존 엔티티(host/opponent) → 계약(SIDE_A/SIDE_B) 매핑의 단일 출처(D3: 엔티티는 바꾸지 않는다).
  private toSpeakers(debate: Debate): DebateSpeakers {
    if (debate.opponentId === null) {
      throw new GeneralException(DebateChatErrorCode.OPPONENT_MISSING);
    }
    return {
      [DebateSide.SIDE_A]: debate.hostId,
      [DebateSide.SIDE_B]: debate.opponentId,
    };
  }
}
