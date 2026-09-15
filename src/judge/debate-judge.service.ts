import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import {
  DebateSide,
  DebateSpeakers,
  DebateTurnSchedule,
  resolveSide,
  resolveSpeakers,
} from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { MembersService } from '../members/members.service';
import {
  JudgeTaskKind,
  DebateViolation,
  JudgmentWinner,
  ViolationSeverity,
} from './judge.types';
import { JudgeTaskHandler, NonRetryableTaskError } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import { JudgeTask } from './entities/judge-task.entity';
import { DEBATE_JUDGE, SILENT_TURN_PLACEHOLDER } from './llm/judge-llm';
import type {
  DebateJudge,
  DebateJudgeResult,
  JudgeComponentSummary,
  JudgeRelationSummary,
  JudgeTranscriptTurn,
  SideJudgment,
} from './llm/judge-llm';

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/**
 * 총점 가중치. 논증을 가장 무겁게 보고 나머지 둘을 같게 둔다.
 * 합이 1이므로 총점도 0~100이며, 값이 바뀌면 과거 판정과 비교할 수 없다는 점만 유의한다.
 */
export const SCORE_WEIGHTS = {
  argumentation: 0.4,
  interaction: 0.3,
  factualReliability: 0.3,
} as const;

/**
 * 위반 정도별 신뢰도 차감량. 이 표가 차감 정책의 단일 출처다.
 * 판정기(LLM 어댑터)가 아니라 여기에 두는 이유는, 벤더를 바꾸거나 판정을 별도 서비스로
 * 떼어내도 정책은 그대로 남아야 하기 때문이다.
 */
export const SOCIAL_CREDIT_PENALTY: Record<ViolationSeverity, number> = {
  minor: 1,
  moderate: 3,
  high: 7,
  severe: 15,
};

// 위반 목록을 신뢰도 차감량으로 환산한다(건별 합산). 위반이 없으면 0.
export function toSocialCreditPenalty(violations: DebateViolation[]): number {
  return violations.reduce(
    (sum, violation) => sum + SOCIAL_CREDIT_PENALTY[violation.severity],
    0,
  );
}

// Score Validator가 거부한 결과. 다시 물으면 달라질 수 있으므로 재시도 대상이다.
export class JudgmentScoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgmentScoreValidationError';
  }
}

// 총점 계산에 필요한 것은 세 점수뿐이다(피드백·위반은 총점에 들어가지 않는다).
export type SideScores = Pick<
  SideJudgment,
  'argumentationScore' | 'interactionScore' | 'factualReliabilityScore'
>;

// 총점 = 가중합(반올림). LLM이 아니라 서버가 계산한다(내부 설계 다이어그램).
export function calculateTotalScore(scores: SideScores): number {
  return Math.round(
    scores.argumentationScore * SCORE_WEIGHTS.argumentation +
      scores.interactionScore * SCORE_WEIGHTS.interaction +
      scores.factualReliabilityScore * SCORE_WEIGHTS.factualReliability,
  );
}

// 승자도 서버가 정한다. 총점이 정확히 같을 때만 무승부다.
export function decideWinner(
  sideATotal: number,
  sideBTotal: number,
): JudgmentWinner {
  if (sideATotal === sideBTotal) {
    return JudgmentWinner.DRAW;
  }
  return sideATotal > sideBTotal
    ? JudgmentWinner.SIDE_A
    : JudgmentWinner.SIDE_B;
}

// 로그 한 줄에 싣는 세 축의 점수. 총점은 서버가 따로 계산하므로 여기 넣지 않는다.
function describeScores(scores: SideScores): string {
  return (
    `논증 ${scores.argumentationScore}` +
    `/상호작용 ${scores.interactionScore}` +
    `/사실 ${scores.factualReliabilityScore}`
  );
}

/**
 * 토론 1건의 최종 판정. 대상(task.targetId)은 토론 자체이며 토론당 한 번만 실행된다.
 *
 * LLM은 전사·논증·검증 결과를 한 번에 받아 편별 세 축의 점수와 피드백만 낸다. 총점(가중합)과
 * 승자는 서버가 계산한다 — 같은 점수에서 늘 같은 결론이 나와야 하고, 가중치를 바꾸는 것이
 * 모델 재판정이 되면 안 되기 때문이다.
 */
@Injectable()
export class DebateJudgeService implements JudgeTaskHandler {
  private readonly logger = new Logger(DebateJudgeService.name);
  readonly kind = JudgeTaskKind.JUDGE;

  constructor(
    @Inject(DEBATE_JUDGE)
    private readonly judge: DebateJudge,
    @InjectRepository(DebateMessage)
    private readonly messages: Repository<DebateMessage>,
    private readonly results: JudgeResultRepository,
    private readonly debates: DebatesService,
    private readonly members: MembersService,
  ) {}

  // 판정은 토론 단위라 턴 접두사가 없다.
  describe(): Promise<string | null> {
    return Promise.resolve(null);
  }

  async handle(task: JudgeTask): Promise<void> {
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const speakers = resolveSpeakers(debate);
    if (speakers === null) {
      throw new NonRetryableTaskError(
        `상대가 없는 토론은 판정할 수 없습니다: debateId=${debate.id}`,
      );
    }

    const result = await this.judge.judge({
      topic: debate.topic,
      sideANickname: debate.hostNickname,
      sideBNickname: debate.opponentNickname ?? '',
      turns: await this.loadTranscript(debate, speakers),
      ...(await this.loadArgumentGraph(debate.id)),
    });

    // 범위를 벗어난 점수로 총점을 계산하면 결과 전체가 무의미해진다. 거부되면 재시도로 넘어간다.
    this.validateJudgment(result);

    const sideATotalScore = calculateTotalScore(result.sideA);
    const sideBTotalScore = calculateTotalScore(result.sideB);
    const winner = decideWinner(sideATotalScore, sideBTotalScore);

    // 위반은 승패와 무관하게 그 편의 신뢰도에서만 깎는다. 총점에는 반영하지 않는다.
    const sideASocialCreditPenalty = toSocialCreditPenalty(
      result.sideA.violations,
    );
    const sideBSocialCreditPenalty = toSocialCreditPenalty(
      result.sideB.violations,
    );

    await this.results.completeJudgment(
      {
        debateId: debate.id,
        winner,
        sideAArgumentationScore: result.sideA.argumentationScore,
        sideAInteractionScore: result.sideA.interactionScore,
        sideAFactualReliabilityScore: result.sideA.factualReliabilityScore,
        sideATotalScore,
        sideBArgumentationScore: result.sideB.argumentationScore,
        sideBInteractionScore: result.sideB.interactionScore,
        sideBFactualReliabilityScore: result.sideB.factualReliabilityScore,
        sideBTotalScore,
        overallReason: result.overallReason,
        sideAFeedback: result.sideA.feedback,
        sideBFeedback: result.sideB.feedback,
        sideAViolations: result.sideA.violations,
        sideBViolations: result.sideB.violations,
        sideASocialCreditPenalty,
        sideBSocialCreditPenalty,
        model: result.model,
        winnerId: this.resolveWinnerId(debate, winner),
      },
      // 판정과 차감은 함께 남거나 함께 없어야 한다(근거 없는 차감을 만들지 않는다).
      async (manager) => {
        await this.members.deductSocialCredit(
          speakers[DebateSide.SIDE_A],
          sideASocialCreditPenalty,
          manager,
        );
        await this.members.deductSocialCredit(
          speakers[DebateSide.SIDE_B],
          sideBSocialCreditPenalty,
          manager,
        );
      },
    );

    this.logJudgment(debate.id, result, {
      winner,
      sideATotalScore,
      sideBTotalScore,
    });
    this.logPenalties(debate.id, {
      sideA: sideASocialCreditPenalty,
      sideB: sideBSocialCreditPenalty,
    });
  }

  /**
   * 판정 결과를 로그로 남긴다. 점수·승자는 log, 총평·피드백은 debate_judgment_result에도
   * 남지만 흐름을 이어 보려면 여기가 편하므로 debug로 함께 싣는다.
   * 위반은 종류·정도만 남긴다 — 근거 문장은 상대 발언 원문이라 로그로도 내보내지 않는다.
   */
  private logJudgment(
    debateId: string,
    result: DebateJudgeResult,
    totals: {
      winner: JudgmentWinner;
      sideATotalScore: number;
      sideBTotalScore: number;
    },
  ): void {
    this.logger.log(
      `판정 완료: debateId=${debateId}, winner=${totals.winner}, ` +
        `SIDE_A(${describeScores(result.sideA)} → 총점 ${totals.sideATotalScore}), ` +
        `SIDE_B(${describeScores(result.sideB)} → 총점 ${totals.sideBTotalScore}), ` +
        `model=${result.model}`,
    );

    this.logger.debug(`  총평: ${result.overallReason}`);
    for (const [label, judgment] of [
      ['SIDE_A', result.sideA],
      ['SIDE_B', result.sideB],
    ] as const) {
      this.logger.debug(`  ${label} 피드백: ${judgment.feedback}`);
      for (const violation of judgment.violations) {
        this.logger.debug(
          `  ${label} 위반: ${violation.type}(${violation.severity})`,
        );
      }
    }
  }

  /**
   * 차감 사실을 로그로 남긴다. 계약에 위반 필드가 없어 프론트는 이 사실을 알 수 없으므로,
   * 문의가 들어왔을 때 되짚을 곳이 로그와 debate_judgment_result뿐이다.
   */
  private logPenalties(
    debateId: string,
    penalties: { sideA: number; sideB: number },
  ): void {
    if (penalties.sideA === 0 && penalties.sideB === 0) {
      return;
    }
    this.logger.log(
      `위반으로 신뢰도 차감: debateId=${debateId}, SIDE_A=-${penalties.sideA}, SIDE_B=-${penalties.sideB}`,
    );
  }

  /**
   * 판정 결과 검사(내부 설계 "Score Validator").
   * 범위를 벗어난 점수나 빈 피드백이 그대로 저장되면 총점·승자 계산이 통째로 무의미해진다.
   */
  private validateJudgment(result: DebateJudgeResult): void {
    for (const [label, judgment] of [
      ['SIDE_A', result.sideA],
      ['SIDE_B', result.sideB],
    ] as const) {
      const scores: [string, number][] = [
        ['논증', judgment.argumentationScore],
        ['상호작용', judgment.interactionScore],
        ['사실 신뢰도', judgment.factualReliabilityScore],
      ];
      for (const [name, score] of scores) {
        if (
          !Number.isInteger(score) ||
          score < MIN_SCORE ||
          score > MAX_SCORE
        ) {
          throw new JudgmentScoreValidationError(
            `${label}의 ${name} 점수가 ${MIN_SCORE}~${MAX_SCORE} 정수가 아닙니다: ${score}`,
          );
        }
      }
      if (judgment.feedback.trim() === '') {
        throw new JudgmentScoreValidationError(
          `${label}의 피드백이 비어 있습니다.`,
        );
      }
    }

    if (result.overallReason.trim() === '') {
      throw new JudgmentScoreValidationError('총평이 비어 있습니다.');
    }
  }

  /**
   * 확정 턴 전부를 발언 순서대로. 시간 초과로 비어 있는 턴도 빼지 않고 "(발언 없음)"으로 남긴다 —
   * 판정에는 "그 차례를 그냥 넘겼다"는 사실 자체가 필요하다.
   */
  private async loadTranscript(
    debate: Debate,
    speakers: DebateSpeakers,
  ): Promise<JudgeTranscriptTurn[]> {
    const rows = await this.messages.find({
      where: { debateId: debate.id, status: ResourceStatus.NORMAL },
      order: { sequence: 'ASC' },
    });
    const schedule = new DebateTurnSchedule(debate.rebuttalQuestionRounds);

    return rows.flatMap((row) => {
      const sequence = row.sequence;
      const slot = sequence === null ? null : schedule.at(sequence - 1);
      // 확정되지 않았거나 스케줄 밖의 행은 전사에 넣을 자리가 없다(데이터 이상).
      if (sequence === null || slot === null) {
        return [];
      }

      // 편은 발언자에서 파생한다(확정 턴 → 계약 turn 변환과 같은 규칙).
      const speakerSide = resolveSide(speakers, row.memberId);
      if (speakerSide === null) {
        return [];
      }

      const content = (row.body ?? '').trim();
      return [
        {
          sequence,
          phase: slot.phase,
          round: slot.round,
          speakerSide,
          speakerNickname:
            row.memberId === debate.hostId
              ? debate.hostNickname
              : (debate.opponentNickname ?? ''),
          content: content === '' ? SILENT_TURN_PLACEHOLDER : content,
        },
      ];
    });
  }

  /**
   * 논증 그래프(마디 + 간선)와 사실 검증 결과를 판정 입력으로 만든다.
   *
   * 간선이 함께 가야 상호작용 점수를 매길 수 있다 — "상대 주장에 응답했는가"는 마디 목록만
   * 봐서는 알 수 없고 ATTACK·QUESTION이 누구를 겨냥했는지에 드러난다.
   * 긴 문장을 두 번 싣지 않도록 마디에 짧은 별칭(#1, #2 …)을 붙이고 간선은 그 별칭으로 잇는다.
   */
  private async loadArgumentGraph(debateId: string): Promise<{
    components: JudgeComponentSummary[];
    relations: JudgeRelationSummary[];
  }> {
    const components = await this.results.findComponents(debateId);
    const checkByComponentId = new Map(
      (await this.results.findFactChecks(debateId)).map((check) => [
        check.componentId,
        check,
      ]),
    );

    // 별칭은 발언 순서를 따른다(findComponents가 턴 순서로 돌려준다).
    const refByComponentId = new Map(
      components.map((component, index) => [component.id, `#${index + 1}`]),
    );

    const relations = (await this.results.findRelations(debateId)).flatMap(
      (relation) => {
        const fromRef = refByComponentId.get(relation.fromComponentId);
        const toRef = refByComponentId.get(relation.toComponentId);
        // 양끝이 모두 살아 있는 간선만 넘긴다(재분석으로 마디가 교체된 경우 방어).
        return fromRef === undefined || toRef === undefined
          ? []
          : [{ fromRef, toRef, kind: relation.kind }];
      },
    );

    return {
      components: components.map((component) => {
        const check = checkByComponentId.get(component.id);
        return {
          ref: refByComponentId.get(component.id) as string,
          speakerSide: component.speakerSide,
          kind: component.kind,
          statement: component.statement,
          factCheck:
            check === undefined
              ? null
              : { status: check.status, reason: check.reason },
        };
      }),
      relations,
    };
  }

  // 무승부는 승자를 비워 둔다. 판정 결과의 winner 열거형이 승패의 단일 출처다.
  private resolveWinnerId(
    debate: Debate,
    winner: JudgmentWinner,
  ): string | null {
    if (winner === JudgmentWinner.SIDE_A) {
      return debate.hostId;
    }
    return winner === JudgmentWinner.SIDE_B ? debate.opponentId : null;
  }
}
