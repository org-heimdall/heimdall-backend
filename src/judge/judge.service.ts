import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebateChatTurn } from '../debate-chat/debate-chat.types';
import { DebateOutcomeService } from '../debate-outcomes/debate-outcome.service';
import {
  DebateOutcome,
  DebateOutcomeKind,
} from '../debate-outcomes/debate-outcome.types';
import {
  DebateRound,
  DebateTurnSchedule,
  resolveSide,
  resolveSpeakers,
} from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateDto } from '../debates/dto/debate.dto';
import { DebateEndReason } from '../debates/entities/debate-end-reason.enum';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { Debate } from '../debates/entities/debate.entity';
import { JudgeConfig } from './judge.config';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeTaskKind } from './judge.types';
import {
  JudgeTaskQueue,
  JudgeTaskListener,
  TaskOutcome,
} from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import { DebateResultDto, JudgmentResultDto } from './dto/debate-result.dto';
import { JudgeTask } from './entities/judge-task.entity';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import { DebateResultPresenter } from './debate-result.presenter';

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
    private readonly outcomes: DebateOutcomeService,
    private readonly presenter: DebateResultPresenter,
  ) {}

  // ------------------------------------------------------------- 채팅 훅

  /**
   * 라운드를 닫는 턴이 확정되면 그 라운드의 분석 작업 하나를 만든다(대상 = 이 턴).
   * 라운드 중간 턴은 아무것도 하지 않고, 라운드 전체가 빈 턴(시간 초과)이면 뽑아낼 주장이 없어 만들지 않는다.
   */
  async onTurnFinalized(turn: DebateChatTurn): Promise<void> {
    const debate = await this.debates.findOneOrThrow(turn.debateId);
    const schedule = new DebateTurnSchedule(debate.rebuttalQuestionRounds);
    if (!schedule.isRoundClosing(turn.sequence - 1)) {
      return;
    }

    const round = schedule.roundOf(turn.sequence - 1) as DebateRound;
    const turns = await this.findRoundTurns(debate.id, round);
    if (!this.hasSpeech(turns)) {
      this.logger.log(
        `발언이 없는 라운드라 분석하지 않습니다: debateId=${turn.debateId}, round #${round.ordinal}`,
      );
      return;
    }

    await this.queue.schedule(turn.debateId, JudgeTaskKind.ANALYZER, turn.id);
  }

  /**
   * 토론이 끝나면 판정 조건을 확인한다. 대개 분석이 아직 남아 있어 여기서는 시작되지 않고,
   * 마지막 분석이 끝나는 순간 그쪽에서 시작된다(어느 쪽이 먼저든 결과는 같다).
   *
   * 마지막 턴의 onTurnFinalized와 이 훅은 동시에 백그라운드로 불린다. 집계가 마지막 라운드 작업 생성보다
   * 먼저 일어나면 그 라운드를 분석하지 않은 채 판정이 시작될 수 있으므로, 집계 전에 라운드 작업을 먼저
   * 보장한다(작업 생성은 멱등이라 두 경로가 겹쳐도 하나뿐이다).
   */
  async onDebateEnded(debateId: string): Promise<void> {
    await this.ensureRoundAnalyzers(debateId);
    const readiness = await this.tryStartJudge(debateId);
    this.logger.log(
      `토론 종료 처리: debateId=${debateId}, readiness=${readiness}`,
    );
  }

  /**
   * 작업이 확정될 때마다(성공·최종 실패 모두) 다시 판단한다.
   * 판정 자신의 성공은 결과 반영까지 끝난 것이라 볼 일이 없고, 최종 실패면 토론을 판정 실패로 닫는다
   * (/judge/retry로 되살릴 수 있다).
   */
  async onTaskSettled(task: JudgeTask, outcome: TaskOutcome): Promise<void> {
    if (task.kind !== JudgeTaskKind.JUDGE) {
      await this.tryStartJudge(task.debateId);
      return;
    }
    if (outcome === 'FAILED') {
      const debate = await this.debates.findOneOrThrow(task.debateId);
      await this.failJudgment(debate);
    }
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
      await this.failJudgment(debate);
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
   * 판정 단계로 넘기기(계약 POST /debates/:id/judging). 끝난 토론을 JUDGING으로 옮기고
   * 지금의 토론 상태를 돌려준다.
   *
   * /judge와 나뉘어 있는 이유는 답하는 것이 다르기 때문이다 — 이쪽은 "토론이 지금 어느 단계인가"를
   * Debate로 알려 주고(그래서 아직 판정 전이어도 200이다), /judge는 완성된 판정 결과를 달라는
   * 요청이라 준비되지 않았으면 409로 답한다. 화면 전환은 이 경로만 있으면 된다.
   */
  async startJudging(debateId: string, memberId: string): Promise<DebateDto> {
    const debate = await this.debates.findOneOrThrow(debateId);
    this.assertParticipant(debate, memberId);

    // 아직 끝나지 않은 토론만 거절한다. 나머지(진행 중·이미 완료·분석 실패)는 상태로 드러난다.
    if ((await this.tryStartJudge(debateId)) === 'NOT_FINALIZED') {
      throw new GeneralException(JudgeErrorCode.NOT_FINALIZED);
    }
    return this.debates.findOneDto(debateId);
  }

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
      return this.presenter.presentJudgment(debate, completed);
    }

    const scheduled = await this.ensureRoundAnalyzers(debateId);
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
    // 판정 없이 끝난 토론(기권·전체 시간 초과)은 되살리지 않는다 — 판정·보상이 겹친다.
    if (
      debate.debateStatus === DebateStatus.FAILED &&
      debate.endReason !== DebateEndReason.JUDGMENT_FAILED
    ) {
      throw new GeneralException(JudgeErrorCode.NOTHING_TO_RETRY);
    }

    const failed = await this.tasks.findFailed(debateId, RETRYABLE_KINDS);
    const missing = await this.ensureRoundAnalyzers(debateId);
    if (failed.length === 0 && missing === 0) {
      throw new GeneralException(JudgeErrorCode.NOTHING_TO_RETRY);
    }

    this.assertCooldownPassed(failed.map((task) => task.updatedAt));

    // 판정 실패로 FAILED가 된 토론을 판정 가능한 상태로 먼저 되돌린다. 작업을 먼저 올리면 판정이
    // 되돌리기 전에 끝나 조건부 전이에서 질 수 있다. 커뮤니티는 결정대로 WAITING에 둔다.
    await this.results.restoreFinalized(debateId);
    for (const task of await this.tasks.resetFailed(
      debateId,
      RETRYABLE_KINDS,
    )) {
      await this.queue.enqueue(task);
    }

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
      judgmentResult: await this.presenter.presentJudgment(debate, judgment),
      factChecks: await this.presenter.presentFactChecks(debateId),
    });
  }

  /**
   * 판정할 수 없게 된 토론을 FAILED + JUDGMENT_FAILED로 닫고, 같은 트랜잭션에서 커뮤니티를 복귀시킨다.
   * 전이가 성공한 호출만 반영하므로 분석 실패·판정 실패 경로가 겹쳐도 한 번뿐이다.
   */
  private async failJudgment(debate: Debate): Promise<void> {
    const outcome: DebateOutcome = {
      debateId: debate.id,
      communityId: debate.communityId,
      kind: DebateOutcomeKind.JUDGMENT_FAILED,
      status: DebateStatus.FAILED,
      reason: DebateEndReason.JUDGMENT_FAILED,
      winnerId: null,
    };
    const moved = await this.results.failJudgment(debate.id, (manager) =>
      this.outcomes.applyWithin(manager, outcome),
    );
    if (moved) {
      await this.outcomes.announce(outcome);
    }
  }

  /**
   * 닫힌 라운드 가운데 분석 작업이 없는 것을 채운다(토론 종료, POST /judge의 재개).
   * 대상은 라운드를 닫는 턴이고, 발언이 하나도 없는 라운드는 건너뛴다. 이미 있는 작업은 그대로 둔다(멱등).
   * 이번에 새로 만든 작업 수를 돌려준다.
   */
  private async ensureRoundAnalyzers(debateId: string): Promise<number> {
    const debate = await this.debates.findOneOrThrow(debateId);
    const turns = await this.messages.find({
      where: { debateId, status: ResourceStatus.NORMAL },
      order: { sequence: 'ASC' },
    });
    const turnBySequence = new Map(
      turns.flatMap((turn) =>
        turn.sequence === null ? [] : [[turn.sequence, turn] as const],
      ),
    );

    let scheduled = 0;
    for (const round of new DebateTurnSchedule(
      debate.rebuttalQuestionRounds,
    ).rounds()) {
      const roundTurns = round.turnIndexes.flatMap((index) => {
        const turn = turnBySequence.get(index + 1);
        return turn === undefined ? [] : [turn];
      });
      const anchor = turnBySequence.get(
        (round.turnIndexes.at(-1) as number) + 1,
      );
      // 아직 닫히지 않은 라운드는 그 라운드의 마지막 턴이 확정될 때 만들어진다.
      if (anchor === undefined || !this.hasSpeech(roundTurns)) {
        continue;
      }
      const existing = await this.tasks.findByTarget(
        JudgeTaskKind.ANALYZER,
        anchor.id,
      );
      if (existing !== null) {
        continue;
      }
      await this.queue.schedule(debateId, JudgeTaskKind.ANALYZER, anchor.id);
      scheduled += 1;
    }
    return scheduled;
  }

  // 라운드의 확정 턴(빈 턴 포함).
  private async findRoundTurns(
    debateId: string,
    round: DebateRound,
  ): Promise<DebateMessage[]> {
    return this.messages.find({
      where: {
        debateId,
        status: ResourceStatus.NORMAL,
        sequence: In(round.turnIndexes.map((index) => index + 1)),
      },
    });
  }

  // 시간 초과로 비어 있지 않은 턴이 하나라도 있는지. 없으면 뽑아낼 주장이 없다.
  private hasSpeech(turns: DebateMessage[]): boolean {
    return turns.some((turn) => (turn.body ?? '').trim() !== '');
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
