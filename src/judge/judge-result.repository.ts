import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { DebateSide } from '../debates/debate-turn';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { Debate } from '../debates/entities/debate.entity';
import {
  DebateViolation,
  FactCheckSource,
  JudgmentWinner,
  VerificationStatus,
} from './judge.types';
import {
  DebateArgumentComponent,
  DebateArgumentRelation,
} from './entities/debate-argument.entity';
import { DebateFactCheckResult } from './entities/debate-fact-check.entity';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';
import { AnalyzerResult } from './llm/judge-llm';

export interface ReplaceTurnGraphInput {
  debateId: string;
  turnId: string;
  turnSequence: number;
  speakerId: string;
  speakerSide: DebateSide;
  result: AnalyzerResult;
  // 이전 턴 컴포넌트의 별칭 → 실제 id. 관계가 과거 컴포넌트를 가리킬 때 쓴다.
  knownRefToId: ReadonlyMap<string, string>;
}

export interface SaveFactCheckInput {
  debateId: string;
  componentId: string;
  status: VerificationStatus;
  reason: string;
  sources: FactCheckSource[];
}

export interface SaveJudgmentInput {
  debateId: string;
  winner: JudgmentWinner;
  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;
  sideATotalScore: number;
  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;
  sideBTotalScore: number;
  overallReason: string;
  sideAFeedback: string;
  sideBFeedback: string;
  // 차감 근거(감사 기록). 계약에는 나가지 않는다.
  sideAViolations: DebateViolation[];
  sideBViolations: DebateViolation[];
  sideASocialCreditPenalty: number;
  sideBSocialCreditPenalty: number;
  model: string;
  // 무승부면 null. 토론 행의 winner_id를 함께 갱신한다.
  winnerId: string | null;
}

/**
 * 파이프라인이 남기는 결과 전부(논증 그래프 · 사실 검증 · 판정)와 토론 진행 단계 전이.
 *
 * 세 결과가 한 저장소에 있는 이유는 읽는 쪽이 언제나 같이 읽기 때문이다 — 판정 입력도,
 * GET /result도 셋을 한 번에 필요로 한다. 토론 상태 전이도 판정 결과 저장과 한 트랜잭션이어야
 * 해서 여기 있다.
 *
 * 상태 전이는 전부 조건부 UPDATE다. 지금 어떤 상태인지 읽고 나서 쓰면 그 사이에 다른 흐름이
 * 끼어들 수 있고, 판정은 "정확히 한 번"이어야 하기 때문이다.
 */
@Injectable()
export class JudgeResultRepository {
  constructor(
    @InjectRepository(DebateArgumentComponent)
    private readonly components: Repository<DebateArgumentComponent>,
    @InjectRepository(DebateArgumentRelation)
    private readonly relations: Repository<DebateArgumentRelation>,
    @InjectRepository(DebateFactCheckResult)
    private readonly factChecks: Repository<DebateFactCheckResult>,
    @InjectRepository(DebateJudgmentResult)
    private readonly judgments: Repository<DebateJudgmentResult>,
    @InjectRepository(Debate)
    private readonly debates: Repository<Debate>,
    private readonly dataSource: DataSource,
  ) {}

  // ------------------------------------------------------------ 논증 그래프

  // 토론의 모든 컴포넌트를 발언 순서대로.
  async findComponents(debateId: string): Promise<DebateArgumentComponent[]> {
    return this.components.find({
      where: { debateId },
      order: { turnSequence: 'ASC', createdAt: 'ASC' },
    });
  }

  // 이번 턴보다 앞선 턴의 컴포넌트. 이번 턴의 반박·질의가 겨냥할 수 있는 대상이다.
  async findComponentsBefore(
    debateId: string,
    turnSequence: number,
  ): Promise<DebateArgumentComponent[]> {
    return this.components.find({
      where: { debateId, turnSequence: LessThan(turnSequence) },
      order: { turnSequence: 'ASC', createdAt: 'ASC' },
    });
  }

  // 토론의 모든 관계. 판정이 "누가 누구를 겨냥했는지"를 보는 입력이다.
  async findRelations(debateId: string): Promise<DebateArgumentRelation[]> {
    return this.relations.findBy({ debateId });
  }

  async findComponentById(
    componentId: string,
  ): Promise<DebateArgumentComponent | null> {
    return this.components.findOneBy({ id: componentId });
  }

  /**
   * 턴 하나의 그래프를 통째로 갈아 끼운다.
   *
   * 재시도로 같은 턴을 다시 분석할 수 있으므로 "추가"가 아니라 "교체"여야 컴포넌트가 중복되지 않는다.
   * 지우는 관계는 이 턴의 컴포넌트가 걸치는 것 전부다 — 한쪽만 지우면 존재하지 않는 컴포넌트를
   * 가리키는 관계가 남는다.
   */
  async replaceTurnGraph(
    input: ReplaceTurnGraphInput,
  ): Promise<DebateArgumentComponent[]> {
    return this.dataSource.transaction(async (manager) => {
      const components = manager.getRepository(DebateArgumentComponent);
      const relations = manager.getRepository(DebateArgumentRelation);

      const previous = await components.findBy({
        debateId: input.debateId,
        turnId: input.turnId,
      });
      if (previous.length > 0) {
        const ids = previous.map((component) => component.id);
        await relations.delete({ fromComponentId: In(ids) });
        await relations.delete({ toComponentId: In(ids) });
        await components.delete({ id: In(ids) });
      }

      const saved = await components.save(
        input.result.components.map((component) =>
          components.create({
            debateId: input.debateId,
            turnId: input.turnId,
            turnSequence: input.turnSequence,
            speakerId: input.speakerId,
            speakerSide: input.speakerSide,
            kind: component.kind,
            statement: component.statement,
            needsFactCheck: component.needsFactCheck,
          }),
        ),
      );

      // 별칭 → id. 이번 턴에서 새로 만든 것과 이전 턴 것을 함께 본다(검증이 이미 통과한 상태다).
      const refToId = new Map(input.knownRefToId);
      input.result.components.forEach((component, index) => {
        refToId.set(component.ref, saved[index].id);
      });

      const rows = input.result.relations.map((relation) =>
        relations.create({
          debateId: input.debateId,
          fromComponentId: refToId.get(relation.fromRef) as string,
          toComponentId: refToId.get(relation.toRef) as string,
          kind: relation.kind,
        }),
      );
      if (rows.length > 0) {
        await relations.save(rows);
      }

      return saved;
    });
  }

  // ------------------------------------------------------------ 사실 검증

  // 토론의 모든 검증 결과. 출처는 같은 행의 jsonb라 따로 조인하지 않는다.
  async findFactChecks(debateId: string): Promise<DebateFactCheckResult[]> {
    return this.factChecks.find({
      where: { debateId },
      order: { checkedAt: 'ASC' },
    });
  }

  /**
   * 컴포넌트 하나의 검증 결과를 갈아 끼운다. 재시도로 같은 컴포넌트를 다시 검증할 수 있으므로
   * 추가가 아니라 교체여야 결과가 둘로 늘어나지 않는다(출처는 같은 행이라 함께 바뀐다).
   */
  async replaceFactCheck(input: SaveFactCheckInput): Promise<void> {
    await this.factChecks.delete({ componentId: input.componentId });

    await this.factChecks.save(
      this.factChecks.create({
        debateId: input.debateId,
        componentId: input.componentId,
        status: input.status,
        reason: input.reason,
        checkedAt: new Date(),
        sources: input.sources,
      }),
    );
  }

  // ---------------------------------------------------------------- 판정

  async findJudgment(debateId: string): Promise<DebateJudgmentResult | null> {
    return this.judgments.findOneBy({ debateId });
  }

  /**
   * 판정 시작(DEBATE_FINALIZED → JUDGING)과 시작 시각 기록.
   * 이미 JUDGING이거나 끝난 토론이면 아무 행도 바뀌지 않는다.
   */
  async startJudging(debateId: string): Promise<boolean> {
    return this.transitionDebate(debateId, DebateStatus.JUDGING, [
      DebateStatus.DEBATE_FINALIZED,
    ]);
  }

  // 판정할 수 없게 된 토론(분석 최종 실패). /judge/retry로만 풀린다.
  async markFailed(debateId: string): Promise<boolean> {
    return this.transitionDebate(debateId, DebateStatus.FAILED, [
      DebateStatus.DEBATE_FINALIZED,
      DebateStatus.JUDGING,
    ]);
  }

  // 판정 실패 뒤 재개할 수 있도록 FAILED를 DEBATE_FINALIZED로 되돌린다(POST /judge/retry).
  async restoreFinalized(debateId: string): Promise<boolean> {
    return this.transitionDebate(debateId, DebateStatus.DEBATE_FINALIZED, [
      DebateStatus.FAILED,
    ]);
  }

  /**
   * 판정 확정. 결과 저장·토론 전이(COMPLETED·승자)·`withinTransaction`이 하나의 트랜잭션이다.
   *
   * 결과만 남고 상태가 안 바뀌면 프론트가 영원히 판정 중으로 보고, 신뢰도만 깎이고 판정이
   * 안 남으면 근거 없는 차감이 된다. 그래서 부수 작업(신뢰도 차감)을 호출자에게서 받아
   * 같은 트랜잭션 안에서 돌린다 — 무엇을 깎을지는 도메인 판단이라 저장소가 알 필요가 없다.
   */
  async completeJudgment(
    input: SaveJudgmentInput,
    withinTransaction: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const judgments = manager.getRepository(DebateJudgmentResult);
      // 재판정(retry)이면 이전 결과를 갈아 끼운다. 토론당 결과는 하나뿐이다.
      await judgments.delete({ debateId: input.debateId });

      // winnerId는 판정 결과가 아니라 토론 행의 컬럼이므로 결과에서 뺀다.
      const { winnerId, ...columns } = input;
      await judgments.save(
        judgments.create({ ...columns, judgedAt: new Date() }),
      );

      await manager
        .getRepository(Debate)
        .createQueryBuilder()
        .update(Debate)
        .set({ debateStatus: DebateStatus.COMPLETED, winnerId })
        .where('id = :debateId', { debateId: input.debateId })
        .execute();

      await withinTransaction(manager);
    });
  }

  // 토론 진행 단계 전이. 기대한 단계일 때만 바뀐다.
  private async transitionDebate(
    debateId: string,
    next: DebateStatus,
    expected: DebateStatus[],
  ): Promise<boolean> {
    const result = await this.debates
      .createQueryBuilder()
      .update(Debate)
      .set(
        next === DebateStatus.JUDGING
          ? { debateStatus: next, judgingStartedAt: () => 'now()' }
          : { debateStatus: next },
      )
      .where('id = :debateId', { debateId })
      .andWhere('status = :status', { status: ResourceStatus.NORMAL })
      .andWhere('debate_status IN (:...expected)', { expected })
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
