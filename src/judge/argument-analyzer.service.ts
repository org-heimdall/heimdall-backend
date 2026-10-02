import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { getUniqueViolationConstraint } from '../common/exceptions/unique-violation.util';
import {
  DebateRound,
  DebateSide,
  DebateTurnSchedule,
  resolveSpeakers,
} from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { hashClaim } from './claim-normalizer';
import {
  FactCheckDecision,
  FactCheckTargetPolicy,
} from './fact-check-target.policy';
import { JudgeTaskKind } from './judge.types';
import {
  JudgeTaskHandler,
  NonRetryableTaskError,
  JudgeTaskQueue,
} from './judge-task.worker';
import {
  GraphComponentInput,
  JudgeResultRepository,
} from './judge-result.repository';
import { resolveRound } from './judge-turn-slot';
import {
  ARGUMENT_COMPONENT_CLAIM_HASH_UNIQUE,
  DebateArgumentComponent,
} from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { ARGUMENT_ANALYZER, AnalyzerKnownComponent } from './llm/judge-llm';
import type {
  AnalyzerResult,
  AnalyzerTurn,
  ArgumentAnalyzer,
} from './llm/judge-llm';

// 이전 라운드 컴포넌트에 붙이는 별칭의 접두사. 이번 라운드의 것(LLM이 c1…로 붙인다)과 겹치지 않게 한다.
const KNOWN_REF_PREFIX = 'p';
// 이번 라운드 턴의 별칭 접두사(t1, t2 …).
const TURN_REF_PREFIX = 't';

// 컴포넌트 문장 길이 상한. 한 문장짜리 주장을 벗어나면 요약에 실패한 것으로 본다.
export const MAX_STATEMENT_LENGTH = 500;

// 한 라운드에서 사실 검증을 돌리는 컴포넌트 상한(= 검증 batch 크기). 넘는 것은 우선순위가 낮은 것부터 뺀다.
export const MAX_FACT_CHECKS_PER_ROUND = 5;

/**
 * Graph Validator가 거부한 결과. 같은 입력이라도 다시 물으면 달라질 수 있으므로 재시도 대상이다
 * (worker가 재시도 가능/불가를 예외 종류로 구분한다).
 */
export class ArgumentGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentGraphValidationError';
  }
}

/**
 * 같은 토론의 다른 분석이 같은 주장을 먼저 검증 대상으로 저장했다(동시 분석 경합).
 * 재시도하면 그 주장이 이전 대상으로 보여 중복으로 분류되므로 재시도 대상이다.
 */
export class ClaimHashConflictError extends Error {
  constructor(debateId: string, options?: { cause?: unknown }) {
    super(
      `같은 주장이 이미 검증 대상으로 저장되었습니다: debateId=${debateId}`,
      options,
    );
    this.name = 'ClaimHashConflictError';
  }
}

// 이번 라운드에서 분석에 넣는 턴. 별칭과 발언자 편을 함께 들고 다닌다.
interface RoundTurn {
  ref: string;
  message: DebateMessage;
  speakerSide: DebateSide;
}

/**
 * 라운드(같은 phase·round의 확정 턴 묶음) 하나를 분석해 논증 그래프로 저장하고, 사실 검증 대상이 있으면
 * 그 라운드의 FactCheck batch 작업을 만든다.
 *
 * 대상(task.targetId)은 라운드를 닫는 확정 턴(debate_message.id)이다. 이 기준 이전에 만들어진
 * 턴 단위 작업(라운드 중간 턴)이 와도 그 턴이 속한 라운드를 분석한다.
 */
@Injectable()
export class ArgumentAnalyzerService implements JudgeTaskHandler {
  private readonly logger = new Logger(ArgumentAnalyzerService.name);
  readonly kind = JudgeTaskKind.ANALYZER;

  constructor(
    @Inject(ARGUMENT_ANALYZER)
    private readonly analyzer: ArgumentAnalyzer,
    @InjectRepository(DebateMessage)
    private readonly messages: Repository<DebateMessage>,
    private readonly results: JudgeResultRepository,
    private readonly debates: DebatesService,
    private readonly queue: JudgeTaskQueue,
    private readonly policy: FactCheckTargetPolicy,
  ) {}

  // 분석은 라운드 단위이므로 stage 메시지에 몇 번째 라운드인지 남긴다.
  async describe(task: JudgeTask): Promise<string | null> {
    const turn = await this.messages.findOneBy({ id: task.targetId });
    if (turn === null || turn.sequence === null) {
      return null;
    }
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const round = new DebateTurnSchedule(debate.rebuttalQuestionRounds).roundOf(
      turn.sequence - 1,
    );
    return round === null ? null : `round #${round.ordinal}`;
  }

  async handle(task: JudgeTask): Promise<void> {
    const target = await this.findTurnOrThrow(task.targetId);
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const round = resolveRound(debate, target.sequence as number);
    const roundMessages = await this.findRoundMessages(debate.id, round);
    const turns = this.toRoundTurns(debate, roundMessages);
    if (turns.length === 0) {
      // 빈 라운드에는 작업이 만들어지지 않는다. 그래도 왔다면 뽑아낼 것이 없을 뿐이다.
      this.logger.log(
        `발언이 없는 라운드라 분석하지 않습니다: debateId=${debate.id}, round #${round.ordinal}`,
      );
      return;
    }

    const previous = await this.results.findComponentsBefore(
      debate.id,
      round.turnIndexes[0] + 1,
    );
    // 별칭은 프롬프트 안에서만 쓰고, 저장할 때 실제 id로 되돌린다.
    const knownRefToId = new Map(
      previous.map((component, index) => [
        `${KNOWN_REF_PREFIX}${index + 1}`,
        component.id,
      ]),
    );

    const analyzed = await this.analyzer.analyze({
      topic: debate.topic,
      round: {
        phase: round.phase,
        round: round.round,
        turns: turns.map((turn) => this.toAnalyzerTurn(debate, turn)),
      },
      previousComponents: this.toKnownComponents(previous),
      logContext: {
        debateId: debate.id,
        turnIds: turns.map((turn) => turn.message.id),
        phase: round.phase,
        round: round.round,
      },
    });

    // 형식은 맞아도 참조가 어긋날 수 있다. 거부되면 예외가 올라가 worker가 재시도한다.
    this.validateGraph(analyzed, previous, turns);

    const decisions = this.policy.decide({
      candidates: analyzed.components.map((component) => ({
        ref: component.ref,
        statement: component.statement,
        claimType: component.claimType,
        needsFactCheck: component.needsFactCheck,
        factCheckStatement: component.factCheckStatement,
        duplicateOfRef: component.duplicateOfRef,
      })),
      knownTargets: this.toKnownTargets(previous),
      limit: MAX_FACT_CHECKS_PER_ROUND,
    });
    this.logResult(debate.id, round, analyzed, decisions);

    await this.saveGraph({
      debateId: debate.id,
      turnIds: roundMessages.map((message) => message.id),
      components: this.toGraphComponents(analyzed, decisions, turns),
      relations: analyzed.relations,
      knownRefToId,
    });

    // 검증이 필요한 주장이 없으면 FactCheck 작업도 만들지 않는다(비용). 있으면 라운드당 batch 하나다.
    // 재분석으로 컴포넌트가 바뀌었을 수 있으므로 이미 끝난 작업이어도 다시 돌린다.
    if (decisions.some((decision) => decision.needsFactCheck)) {
      await this.queue.reschedule(
        debate.id,
        JudgeTaskKind.FACT_CHECK,
        this.anchorOf(round, roundMessages, target).id,
      );
    }
  }

  // 그래프 저장. 동시에 돈 다른 분석이 같은 주장을 먼저 저장했다면 재시도해 중복으로 분류되게 한다.
  private async saveGraph(
    input: Parameters<JudgeResultRepository['replaceRoundGraph']>[0],
  ): Promise<void> {
    try {
      await this.results.replaceRoundGraph(input);
    } catch (error: unknown) {
      if (
        getUniqueViolationConstraint(error) ===
        ARGUMENT_COMPONENT_CLAIM_HASH_UNIQUE
      ) {
        throw new ClaimHashConflictError(input.debateId, { cause: error });
      }
      throw error;
    }
  }

  // 분석 결과와 정책 결정을 저장할 값으로 합친다. 발언자·턴은 컴포넌트가 나온 턴(turn_ref)에서 온다.
  private toGraphComponents(
    analyzed: AnalyzerResult,
    decisions: FactCheckDecision[],
    turns: RoundTurn[],
  ): GraphComponentInput[] {
    const turnByRef = new Map(turns.map((turn) => [turn.ref, turn]));
    return analyzed.components.map((component, index) => {
      const turn = turnByRef.get(component.turnRef) as RoundTurn;
      const decision = decisions[index];
      return {
        ref: component.ref,
        turnId: turn.message.id,
        turnSequence: turn.message.sequence as number,
        speakerId: turn.message.memberId,
        speakerSide: turn.speakerSide,
        kind: component.kind,
        statement: component.statement,
        claimType: component.claimType,
        needsFactCheck: decision.needsFactCheck,
        factCheckStatement: decision.factCheckStatement,
        claimHash: decision.claimHash,
        factCheckExclusionReason: decision.exclusionReason,
        duplicateOfRef: decision.duplicateOfRef,
      };
    });
  }

  /**
   * 분석 결과를 로그로 남긴다. 요약(검증 대상·제외 사유별 건수)은 log, 뽑아낸 마디·간선 전체는 debug다.
   * 간선은 LLM이 붙인 별칭(이번 라운드 c1…, 이전 라운드 p1…)으로 잇는다 — 실제 id는 저장 시점에 붙는다.
   */
  private logResult(
    debateId: string,
    round: DebateRound,
    result: AnalyzerResult,
    decisions: FactCheckDecision[],
  ): void {
    const targetCount = decisions.filter(
      (decision) => decision.needsFactCheck,
    ).length;
    const excluded = new Map<string, number>();
    for (const decision of decisions) {
      if (decision.exclusionReason !== null) {
        excluded.set(
          decision.exclusionReason,
          (excluded.get(decision.exclusionReason) ?? 0) + 1,
        );
      }
    }
    const exclusionSummary =
      excluded.size === 0
        ? '없음'
        : [...excluded]
            .map(([reason, count]) => `${reason}=${count}`)
            .join(',');

    this.logger.log(
      `분석 완료: debateId=${debateId}, round #${round.ordinal}(${round.phase} ${round.round}), ` +
        `컴포넌트 ${result.components.length}건(검증 대상 ${targetCount}건, 제외 ${exclusionSummary}), ` +
        `관계 ${result.relations.length}건`,
    );

    result.components.forEach((component, index) => {
      const decision = decisions[index];
      const mark = decision.needsFactCheck
        ? ` [검증: ${decision.factCheckStatement}]`
        : decision.exclusionReason !== null
          ? ` [제외 ${decision.exclusionReason}]`
          : '';
      this.logger.debug(
        `  round #${round.ordinal} ${component.turnRef}/${component.ref} ${component.kind}(${component.claimType})${mark} ${component.statement}`,
      );
    });
    for (const relation of result.relations) {
      this.logger.debug(
        `  round #${round.ordinal} ${relation.fromRef} --${relation.kind}--> ${relation.toRef}`,
      );
    }
  }

  /**
   * 스키마 통과 뒤의 참조 무결성 검사(내부 설계 "Graph Validator").
   *
   * LLM은 형식은 맞추면서 내용은 얼마든지 어긋나게 낼 수 있다 — 없는 컴포넌트나 턴을 가리키거나,
   * 이전 라운드 컴포넌트가 말을 거는(from) 관계를 만들거나, 같은 라운드에서 먼저 한 발언이 나중 발언을
   * 겨냥하거나, 같은 ref를 두 번 쓰는 식이다. 그대로 저장하면 그래프가 깨지므로 여기서 걸러 재시도로 넘긴다.
   */
  private validateGraph(
    result: AnalyzerResult,
    previous: DebateArgumentComponent[],
    turns: RoundTurn[],
  ): void {
    const knownRefs = new Set(
      previous.map((_, index) => `${KNOWN_REF_PREFIX}${index + 1}`),
    );
    const sequenceOfTurnRef = new Map(
      turns.map((turn) => [turn.ref, turn.message.sequence as number]),
    );
    // 컴포넌트 ref → 발언 순서. 시간 순서 검사에 쓴다(이전 라운드 것은 언제나 앞이다).
    const sequenceOfRef = new Map<string, number>();

    for (const component of result.components) {
      const statement = component.statement.trim();
      if (component.ref.trim() === '') {
        throw new ArgumentGraphValidationError('컴포넌트 ref가 비어 있습니다.');
      }
      if (sequenceOfRef.has(component.ref) || knownRefs.has(component.ref)) {
        throw new ArgumentGraphValidationError(
          `컴포넌트 ref가 중복됩니다: ${component.ref}`,
        );
      }
      const sequence = sequenceOfTurnRef.get(component.turnRef);
      if (sequence === undefined) {
        throw new ArgumentGraphValidationError(
          `컴포넌트가 이번 라운드에 없는 발언을 가리킵니다: ${component.ref} → ${component.turnRef}`,
        );
      }
      if (statement === '') {
        throw new ArgumentGraphValidationError(
          `컴포넌트 문장이 비어 있습니다: ${component.ref}`,
        );
      }
      if (statement.length > MAX_STATEMENT_LENGTH) {
        throw new ArgumentGraphValidationError(
          `컴포넌트 문장이 너무 깁니다(${statement.length}자): ${component.ref}`,
        );
      }
      sequenceOfRef.set(component.ref, sequence);
    }

    for (const relation of result.relations) {
      // 관계를 거는 쪽은 언제나 이번 라운드의 발언이다. 이전 라운드 컴포넌트가 from이면 시간을 거스른다.
      const fromSequence = sequenceOfRef.get(relation.fromRef);
      if (fromSequence === undefined) {
        throw new ArgumentGraphValidationError(
          `관계의 출발 컴포넌트가 이번 라운드에 없습니다: ${relation.fromRef}`,
        );
      }
      if (
        !sequenceOfRef.has(relation.toRef) &&
        !knownRefs.has(relation.toRef)
      ) {
        throw new ArgumentGraphValidationError(
          `관계가 존재하지 않는 컴포넌트를 가리킵니다: ${relation.toRef}`,
        );
      }
      if (relation.fromRef === relation.toRef) {
        throw new ArgumentGraphValidationError(
          `컴포넌트가 자기 자신을 가리킵니다: ${relation.fromRef}`,
        );
      }
      // 같은 라운드에서 먼저 한 발언은 나중 발언을 겨냥할 수 없다.
      const toSequence = sequenceOfRef.get(relation.toRef);
      if (toSequence !== undefined && fromSequence < toSequence) {
        throw new ArgumentGraphValidationError(
          `먼저 한 발언이 나중 발언을 가리킵니다: ${relation.fromRef} → ${relation.toRef}`,
        );
      }
    }
  }

  private toKnownComponents(
    previous: DebateArgumentComponent[],
  ): AnalyzerKnownComponent[] {
    return previous.map((component, index) => ({
      ref: `${KNOWN_REF_PREFIX}${index + 1}`,
      speakerSide: component.speakerSide,
      kind: component.kind,
      statement: component.statement,
      factCheckStatement: component.needsFactCheck
        ? (component.factCheckStatement ?? component.statement)
        : null,
    }));
  }

  // 이미 검증 대상인 이전 컴포넌트: 별칭 → claim hash. 레거시 행(hash 없음)은 문장으로 계산한다.
  private toKnownTargets(
    previous: DebateArgumentComponent[],
  ): Map<string, string> {
    const targets = new Map<string, string>();
    previous.forEach((component, index) => {
      if (component.needsFactCheck) {
        targets.set(
          `${KNOWN_REF_PREFIX}${index + 1}`,
          component.claimHash ??
            hashClaim(component.factCheckStatement ?? component.statement),
        );
      }
    });
    return targets;
  }

  private toAnalyzerTurn(debate: Debate, turn: RoundTurn): AnalyzerTurn {
    return {
      ref: turn.ref,
      sequence: turn.message.sequence as number,
      speakerSide: turn.speakerSide,
      speakerNickname: this.resolveNickname(debate, turn.message.memberId),
      content: (turn.message.body ?? '').trim(),
    };
  }

  // 라운드의 확정 턴 전부(빈 턴 포함), 발언 순서대로. 교체 범위와 작업 앵커를 정하는 데 쓴다.
  private async findRoundMessages(
    debateId: string,
    round: DebateRound,
  ): Promise<DebateMessage[]> {
    return this.messages.find({
      where: {
        debateId,
        status: ResourceStatus.NORMAL,
        sequence: In(round.turnIndexes.map((index) => index + 1)),
      },
      order: { sequence: 'ASC' },
    });
  }

  // 분석에 넣을 턴. 시간 초과로 비어 있는 턴은 뽑아낼 주장이 없어 뺀다.
  private toRoundTurns(debate: Debate, messages: DebateMessage[]): RoundTurn[] {
    return messages
      .filter((message) => (message.body ?? '').trim() !== '')
      .map((message, index) => ({
        ref: `${TURN_REF_PREFIX}${index + 1}`,
        message,
        speakerSide: this.resolveSide(debate, message.memberId),
      }));
  }

  // 라운드 작업의 앵커 = 라운드를 닫는 턴. 레거시 작업처럼 라운드 중간 턴이 대상이어도 같은 앵커로 모은다.
  private anchorOf(
    round: DebateRound,
    messages: DebateMessage[],
    fallback: DebateMessage,
  ): DebateMessage {
    const closingSequence = (round.turnIndexes.at(-1) as number) + 1;
    return (
      messages.find((message) => message.sequence === closingSequence) ??
      fallback
    );
  }

  /**
   * 분석 대상 턴. 삭제됐거나 확정되지 않은(sequence 없는) 행은 다시 시도해도 달라지지 않는다.
   */
  private async findTurnOrThrow(turnId: string): Promise<DebateMessage> {
    const turn = await this.messages.findOneBy({
      id: turnId,
      status: ResourceStatus.NORMAL,
    });
    if (turn === null || turn.sequence === null) {
      throw new NonRetryableTaskError(
        `분석할 확정 턴이 없습니다: turnId=${turnId}`,
      );
    }
    return turn;
  }

  private resolveSide(debate: Debate, memberId: string): DebateSide {
    const speakers = resolveSpeakers(debate);
    if (speakers === null) {
      throw new NonRetryableTaskError(
        `상대가 없는 토론은 분석할 수 없습니다: debateId=${debate.id}`,
      );
    }
    return memberId === speakers[DebateSide.SIDE_A]
      ? DebateSide.SIDE_A
      : DebateSide.SIDE_B;
  }

  private resolveNickname(debate: Debate, memberId: string): string {
    return memberId === debate.hostId
      ? debate.hostNickname
      : (debate.opponentNickname ?? '');
  }
}
