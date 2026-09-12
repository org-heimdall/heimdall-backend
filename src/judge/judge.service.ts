import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebateChatTurn } from '../debate-chat/debate-chat.types';
import { resolveSide, resolveSpeakers } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { Debate } from '../debates/entities/debate.entity';
import { JudgeConfig } from './judge.config';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeTaskKind } from './judge.types';
import { JudgeTaskQueue, JudgeTaskListener } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  DebateResultDto,
  FactCheckResultDto,
  JudgmentResultDto,
} from './dto/debate-result.dto';
import { JudgeTask } from './entities/judge-task.entity';
import { JudgeErrorCode } from './exceptions/judge-error-code';

// 재시도로 되돌릴 작업 종류. FactCheck 실패는 판정을 막지 않으므로 여기 없다.
const RETRYABLE_KINDS = [JudgeTaskKind.ANALYZER, JudgeTaskKind.JUDGE];

// 판정을 시작할 수 없는 이유. REST가 이걸로 응답을 나눈다.
export type JudgeReadiness =
  | 'STARTED' // Judge 작업이 준비됐다(이번에 만들었거나 이미 있다)
  | 'NOT_FINALIZED' // 토론이 아직 끝나지 않았다
  | 'ALREADY_COMPLETED' // 판정이 이미 끝났다
  | 'ANALYZER_FAILED' // 분석이 최종 실패해 판정할 수 없다
  | 'IN_PROGRESS'; // 앞 단계가 아직 돌고 있다

/**
 * 파이프라인을 미는 쪽 전부. 채팅 훅과 REST 3개, 그리고 둘이 함께 쓰는 판정 조건 평가가 있다.
 *
 * 하는 일은 "작업을 만든다"와 "지금 판정해도 되는지 본다" 둘뿐이다. 실제 실행은 worker가 하므로
 * finalize 응답도, REST 응답도 LLM 호출을 기다리지 않는다.
 *
 * POST /judge는 시작이 아니라 **재개**다: 빠진 분석 작업부터 채우고 조건을 다시 본다.
 * 정상 흐름에서는 이미 다 채워져 있어 곧바로 판정으로 가고, 시드 토론처럼 분석이 통째로 없는
 * 토론도 같은 경로로 결과까지 갈 수 있다.
 */
@Injectable()
export class JudgeService implements JudgeTaskListener {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    @InjectRepository(DebateMessage)
    private readonly messages: Repository<DebateMessage>,
    private readonly tasks: JudgeTaskRepository,
    private readonly queue: JudgeTaskQueue,
    private readonly results: JudgeResultRepository,
    private readonly debates: DebatesService,
    private readonly config: JudgeConfig,
  ) {}

  // ------------------------------------------------------------- 채팅 훅

  // 확정 턴마다 분석 작업 하나. 빈 턴(시간 초과)은 뽑아낼 주장이 없어 작업을 만들지 않는다.
  async onTurnFinalized(turn: DebateChatTurn): Promise<void> {
    if (turn.content.trim() === '') {
      this.logger.log(
        `빈 턴이라 분석하지 않습니다: debateId=${turn.debateId}, sequence=${turn.sequence}`,
      );
      return;
    }

    await this.queue.schedule(turn.debateId, JudgeTaskKind.ANALYZER, turn.id);
  }

  /**
   * 토론이 끝나면 판정 조건을 확인한다. 대개 분석이 아직 남아 있어 여기서는 시작되지 않고,
   * 마지막 분석이 끝나는 순간 그쪽에서 시작된다(어느 쪽이 먼저든 결과는 같다).
   */
  async onDebateEnded(debateId: string): Promise<void> {
    const readiness = await this.tryStartJudge(debateId);
    this.logger.log(
      `토론 종료 처리: debateId=${debateId}, readiness=${readiness}`,
    );
  }

  // 작업이 확정될 때마다(성공·최종 실패 모두) 다시 판단한다. 판정 자신의 결과는 볼 필요가 없다.
  async onTaskSettled(task: JudgeTask): Promise<void> {
    if (task.kind === JudgeTaskKind.JUDGE) {
      return;
    }
    await this.tryStartJudge(task.debateId);
  }

  // ---------------------------------------------------------- 판정 조건

  /**
   * 지금 판정을 시작해도 되는지 보고, 되면 Judge 작업을 만든다.
   * 어디서 몇 번 불러도 결과는 같다 — 작업 행이 (kind, target) unique라 Judge 작업은 토론당 하나다.
   */
  async tryStartJudge(debateId: string): Promise<JudgeReadiness> {
    const debate = await this.debates.findOneOrThrow(debateId);
    const status = debate.debateStatus;

    if (status === DebateStatus.COMPLETED) {
      return 'ALREADY_COMPLETED';
    }
    // 판정을 시작할 수 있는 자리는 "끝났지만 아직 판정 전"과 "이미 판정 중" 둘뿐이다.
    if (
      status !== DebateStatus.DEBATE_FINALIZED &&
      status !== DebateStatus.JUDGING
    ) {
      return 'NOT_FINALIZED';
    }

    const counts = await this.tasks.countByKind(debateId);
    const analyzer = counts[JudgeTaskKind.ANALYZER];
    const factCheck = counts[JudgeTaskKind.FACT_CHECK];

    // 분석이 최종 실패하면 논증 그래프가 반쪽이라 판정할 수 없다. 재개(/judge/retry)로만 풀린다.
    if (analyzer.failed > 0) {
      await this.results.markFailed(debateId);
      this.logger.warn(
        `분석 실패로 판정 불가: debateId=${debateId}, failed=${analyzer.failed}`,
      );
      return 'ANALYZER_FAILED';
    }

    if (analyzer.pending + analyzer.processing > 0) {
      return 'IN_PROGRESS';
    }
    // 검증의 최종 실패는 판정을 막지 않는다. 아직 돌고 있는 것만 기다린다.
    if (factCheck.pending + factCheck.processing > 0) {
      return 'IN_PROGRESS';
    }

    // 판정 작업은 토론 자체를 대상으로 한다.
    await this.queue.schedule(debateId, JudgeTaskKind.JUDGE, debateId);
    await this.results.startJudging(debateId);
    return 'STARTED';
  }

  // ---------------------------------------------------------------- REST

  /**
   * 판정 요청(계약 POST /debates/:id/judge). 이미 끝났으면 저장된 결과를 그대로 돌려주고,
   * 그렇지 않으면 빠진 작업을 채운 뒤 진행 상황에 맞는 409로 답한다(판정은 비동기다).
   */
  async requestJudgment(
    debateId: string,
    memberId: string,
  ): Promise<JudgmentResultDto> {
    const debate = await this.debates.findOneOrThrow(debateId);
    this.assertParticipant(debate, memberId);

    const completed = await this.results.findJudgment(debateId);
    if (completed !== null) {
      return JudgmentResultDto.from(completed);
    }

    const scheduled = await this.resumeAnalyzers(debateId);
    if (scheduled > 0) {
      this.logger.log(
        `빠진 분석 작업 ${scheduled}건을 채웠습니다: debateId=${debateId}`,
      );
    }

    throw this.toReadinessException(await this.tryStartJudge(debateId));
  }

  /**
   * 판정 재시도(계약 POST /debates/:id/judge/retry). 최종 실패한 분석·판정을 되돌려
   * 다시 큐에 올린다. 실패 직후 연타를 막기 위해 쿨다운을 둔다.
   */
  async retryJudgment(
    debateId: string,
    memberId: string,
  ): Promise<JudgmentResultDto> {
    const debate = await this.debates.findOneOrThrow(debateId);
    this.assertParticipant(debate, memberId);

    if ((await this.results.findJudgment(debateId)) !== null) {
      throw new GeneralException(JudgeErrorCode.ALREADY_COMPLETED);
    }

    const failed = await this.tasks.findFailed(debateId, RETRYABLE_KINDS);
    const missing = await this.resumeAnalyzers(debateId);
    if (failed.length === 0 && missing === 0) {
      throw new GeneralException(JudgeErrorCode.NOTHING_TO_RETRY);
    }

    this.assertCooldownPassed(failed.map((task) => task.updatedAt));

    for (const task of await this.tasks.resetFailed(
      debateId,
      RETRYABLE_KINDS,
    )) {
      await this.queue.enqueue(task);
    }
    // 분석 실패로 FAILED가 된 토론을 판정 가능한 상태로 되돌린다.
    await this.results.restoreFinalized(debateId);

    throw this.toReadinessException(await this.tryStartJudge(debateId));
  }

  // 결과 조회(계약 GET /debates/:id/result). 판정이 끝난 토론에만 있다.
  async getResult(
    debateId: string,
    memberId: string,
  ): Promise<DebateResultDto> {
    const debate = await this.debates.findOneOrThrow(debateId);
    const judgment = await this.results.findJudgment(debateId);
    if (judgment === null) {
      throw new GeneralException(JudgeErrorCode.RESULT_NOT_READY);
    }

    return Object.assign(new DebateResultDto(), {
      debate: await this.debates.findOneDto(debateId),
      viewerSide: resolveSide(resolveSpeakers(debate), memberId),
      judgmentResult: JudgmentResultDto.from(judgment),
      factChecks: await this.loadFactChecks(debateId),
    });
  }

  /**
   * 확정된 턴 가운데 분석 작업이 없는 것을 채운다(POST /judge의 재개).
   * 빈 턴은 뽑아낼 주장이 없어 건너뛴다. 이미 있는 작업은 그대로 둔다(멱등).
   */
  private async resumeAnalyzers(debateId: string): Promise<number> {
    const turns = await this.messages.find({
      where: { debateId, status: ResourceStatus.NORMAL },
      order: { sequence: 'ASC' },
    });

    let scheduled = 0;
    for (const turn of turns) {
      if (turn.sequence === null || (turn.body ?? '').trim() === '') {
        continue;
      }
      const existing = await this.tasks.findByTarget(
        JudgeTaskKind.ANALYZER,
        turn.id,
      );
      if (existing !== null) {
        continue;
      }
      await this.queue.schedule(debateId, JudgeTaskKind.ANALYZER, turn.id);
      scheduled += 1;
    }
    return scheduled;
  }

  // 검증 결과에 발언자·문장을 붙인다(계약 FactCheckResult).
  private async loadFactChecks(
    debateId: string,
  ): Promise<FactCheckResultDto[]> {
    const checks = await this.results.findFactChecks(debateId);
    if (checks.length === 0) {
      return [];
    }

    const components = new Map(
      (await this.results.findComponents(debateId)).map((component) => [
        component.id,
        component,
      ]),
    );

    return checks.flatMap((check) => {
      const component = components.get(check.componentId);
      // 재분석으로 컴포넌트가 교체되면 결과만 남을 수 있다. 보여 줄 문장이 없으므로 뺀다.
      return component === undefined
        ? []
        : [FactCheckResultDto.from(check, component)];
    });
  }

  // 마지막 실패로부터 쿨다운이 지나야 재시도를 받는다.
  private assertCooldownPassed(failedAt: Date[]): void {
    if (failedAt.length === 0) {
      return;
    }
    const latest = Math.max(...failedAt.map((date) => date.getTime()));
    const readyAt = latest + this.config.judgeRetryCooldownSeconds * 1000;
    if (Date.now() < readyAt) {
      throw new GeneralException(JudgeErrorCode.RETRY_NOT_READY);
    }
  }

  // 판정 조건을 그대로 응답으로 옮긴다. 판정은 비동기라 성공 경로도 409(진행 중)다.
  private toReadinessException(readiness: JudgeReadiness): GeneralException {
    switch (readiness) {
      case 'NOT_FINALIZED':
        return new GeneralException(JudgeErrorCode.NOT_FINALIZED);
      case 'ALREADY_COMPLETED':
        return new GeneralException(JudgeErrorCode.ALREADY_COMPLETED);
      case 'ANALYZER_FAILED':
        return new GeneralException(JudgeErrorCode.PROCESSING_FAILED);
      default:
        return new GeneralException(JudgeErrorCode.IN_PROGRESS);
    }
  }

  // 판정을 요청할 수 있는 사람은 토론 당사자뿐이다(관전자는 결과 조회만 한다).
  private assertParticipant(debate: Debate, memberId: string): void {
    if (resolveSide(resolveSpeakers(debate), memberId) === null) {
      throw new GeneralException(ErrorCode.FORBIDDEN);
    }
  }
}
