import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import {
  DebatePhase,
  DebateSide,
  DebateTurnSchedule,
  resolveSpeakers,
} from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { JudgeTaskKind } from './judge.types';
import {
  JudgeTaskHandler,
  NonRetryableTaskError,
  JudgeTaskQueue,
} from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { ARGUMENT_ANALYZER, AnalyzerKnownComponent } from './llm/judge-llm';
import type { AnalyzerResult, ArgumentAnalyzer } from './llm/judge-llm';

// 이전 턴 컴포넌트에 붙이는 별칭의 접두사. 이번 턴의 것(LLM이 c1…로 붙인다)과 겹치지 않게 한다.
const KNOWN_REF_PREFIX = 'p';

// 컴포넌트 문장 길이 상한. 한 문장짜리 주장을 벗어나면 요약에 실패한 것으로 본다.
export const MAX_STATEMENT_LENGTH = 500;

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
 * 확정 턴 하나를 분석해 논증 그래프로 저장하고, 사실 확인이 필요한 컴포넌트마다 FactCheck 작업을 만든다.
 * 대상(task.targetId)은 확정 턴(debate_message.id)이다.
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
  ) {}

  // 분석은 턴 단위이므로 stage 메시지에 몇 번째 턴인지 남긴다.
  async describe(task: JudgeTask): Promise<string | null> {
    const turn = await this.messages.findOneBy({ id: task.targetId });
    return turn === null || turn.sequence === null
      ? null
      : `turn #${turn.sequence}`;
  }

  async handle(task: JudgeTask): Promise<void> {
    const turn = await this.findTurnOrThrow(task.targetId);
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const sequence = turn.sequence as number;
    const speakerSide = this.resolveSide(debate, turn.memberId);
    const previous = await this.results.findComponentsBefore(
      task.debateId,
      sequence,
    );

    // 별칭은 프롬프트 안에서만 쓰고, 저장할 때 실제 id로 되돌린다.
    const knownRefToId = new Map(
      previous.map((component, index) => [
        `${KNOWN_REF_PREFIX}${index + 1}`,
        component.id,
      ]),
    );

    const result = await this.analyzer.analyze({
      topic: debate.topic,
      turn: {
        sequence,
        ...this.resolveSlot(debate, sequence),
        speakerSide,
        speakerNickname: this.resolveNickname(debate, turn.memberId),
        content: turn.body ?? '',
      },
      previousComponents: this.toKnownComponents(previous),
    });

    // 형식은 맞아도 참조가 어긋날 수 있다. 거부되면 예외가 올라가 worker가 재시도한다.
    this.validateGraph(result, [...knownRefToId.keys()]);
    this.logResult(task.debateId, sequence, result);

    const saved = await this.results.replaceTurnGraph({
      debateId: task.debateId,
      turnId: turn.id,
      turnSequence: sequence,
      speakerId: turn.memberId,
      speakerSide,
      result,
      knownRefToId,
    });

    // 검증이 필요한 컴포넌트가 없으면 FactCheck 작업도 만들지 않는다(비용, 리스크 표).
    for (const component of saved) {
      if (component.needsFactCheck) {
        await this.queue.schedule(
          task.debateId,
          JudgeTaskKind.FACT_CHECK,
          component.id,
        );
      }
    }
  }

  /**
   * 분석 결과를 로그로 남긴다. 요약은 log, 뽑아낸 마디·간선 전체는 debug다.
   * 간선은 LLM이 붙인 별칭(이번 턴 c1…, 이전 턴 p1…)으로 잇는다 — 실제 id는 저장 시점에 붙는다.
   */
  private logResult(
    debateId: string,
    sequence: number,
    result: AnalyzerResult,
  ): void {
    const factCheckCount = result.components.filter(
      (component) => component.needsFactCheck,
    ).length;
    this.logger.log(
      `분석 완료: debateId=${debateId}, turn #${sequence}, ` +
        `컴포넌트 ${result.components.length}건(검증 대상 ${factCheckCount}건), ` +
        `관계 ${result.relations.length}건`,
    );

    for (const component of result.components) {
      const mark = component.needsFactCheck ? ' [검증]' : '';
      this.logger.debug(
        `  turn #${sequence} ${component.ref} ${component.kind}${mark} ${component.statement}`,
      );
    }
    for (const relation of result.relations) {
      this.logger.debug(
        `  turn #${sequence} ${relation.fromRef} --${relation.kind}--> ${relation.toRef}`,
      );
    }
  }

  /**
   * 스키마 통과 뒤의 참조 무결성 검사(내부 설계 "Graph Validator").
   *
   * LLM은 형식은 맞추면서 내용은 얼마든지 어긋나게 낼 수 있다 — 없는 컴포넌트를 가리키거나,
   * 이전 턴 컴포넌트가 말을 거는(from) 관계를 만들거나, 같은 ref를 두 번 쓰는 식이다.
   * 그대로 저장하면 그래프가 깨지므로 여기서 걸러 재시도로 넘긴다.
   */
  private validateGraph(
    result: AnalyzerResult,
    knownRefs: readonly string[],
  ): void {
    const newRefs = new Set<string>();
    for (const component of result.components) {
      const statement = component.statement.trim();
      if (component.ref.trim() === '') {
        throw new ArgumentGraphValidationError('컴포넌트 ref가 비어 있습니다.');
      }
      if (newRefs.has(component.ref) || knownRefs.includes(component.ref)) {
        throw new ArgumentGraphValidationError(
          `컴포넌트 ref가 중복됩니다: ${component.ref}`,
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
      newRefs.add(component.ref);
    }

    const reachableRefs = new Set([...newRefs, ...knownRefs]);
    for (const relation of result.relations) {
      // 관계를 거는 쪽은 언제나 이번 턴의 발언이다. 이전 턴 컴포넌트가 from이면 시간을 거스른다.
      if (!newRefs.has(relation.fromRef)) {
        throw new ArgumentGraphValidationError(
          `관계의 출발 컴포넌트가 이번 턴에 없습니다: ${relation.fromRef}`,
        );
      }
      if (!reachableRefs.has(relation.toRef)) {
        throw new ArgumentGraphValidationError(
          `관계가 존재하지 않는 컴포넌트를 가리킵니다: ${relation.toRef}`,
        );
      }
      if (relation.fromRef === relation.toRef) {
        throw new ArgumentGraphValidationError(
          `컴포넌트가 자기 자신을 가리킵니다: ${relation.fromRef}`,
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
    }));
  }

  /**
   * 분석 대상 턴. 삭제됐거나 확정되지 않은(sequence 없는) 행은 다시 시도해도 달라지지 않는다.
   * 빈 턴(시간 초과)에 작업이 만들어지지 않는 것은 파이프라인이 보장한다.
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

  // 발언 순서(sequence)에서 phase·round를 파생한다. 규칙은 토론 스케줄 하나에만 있다.
  private resolveSlot(
    debate: Debate,
    sequence: number,
  ): { phase: DebatePhase; round: number } {
    const slot = new DebateTurnSchedule(debate.rebuttalQuestionRounds).at(
      sequence - 1,
    );
    if (slot === null) {
      throw new NonRetryableTaskError(
        `스케줄 범위를 벗어난 턴입니다: sequence=${sequence}`,
      );
    }
    return { phase: slot.phase, round: slot.round };
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
