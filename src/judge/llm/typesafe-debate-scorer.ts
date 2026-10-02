import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { score, TypeSafeClient } from '@typesafe-ai/sdk';
import type {
  EntryType,
  JsonValue,
  ScoreCriteria,
  ScoreQuestion,
  ScoreResponse,
  Usage,
} from '@typesafe-ai/sdk';
import { DebateSide } from '../../debates/debate-turn';
import { MAX_SCORE, MIN_SCORE } from '../debate-judge.service';
import { NonRetryableTaskError } from '../judge-task.worker';
import {
  DebateJudgeRequest,
  DebateScorer,
  DebateScoreResult,
  DebateSideScores,
  SILENT_TURN_PLACEHOLDER,
} from './judge-llm';
import { LlmCallLogger, LlmTokenUsage } from './llm-call-logger';

type ScoreAxis = keyof DebateSideScores;

/*
 * 축 하나의 채점 기준. Jev는 질문 id를 보지 못하고 각 단계를 따로 대조하므로,
 * 질문에 대상 편을 직접 적고 단계는 "정도"가 아니라 "상황"으로 서술한다.
 * 단계는 낮은 쪽부터 높은 쪽 순서이며, 개수를 바꿔도 0~100 환산은 자동으로 따라간다.
 * Jev는 영어가 주 학습 언어라 기준은 영어로 쓰고, 토론 원문(state)은 한국어 그대로 보낸다.
 */
interface AxisRubric {
  question: (side: DebateSide, opponent: DebateSide) => string;
  focus: (side: DebateSide, opponent: DebateSide) => string;
  criteria: ScoreCriteria;
}

const SILENT_TURN_RULE = `A turn whose content is "${SILENT_TURN_PLACEHOLDER}" means the debater said nothing within the time limit; it never counts in their favor.`;

export const AXIS_RUBRICS: Record<ScoreAxis, AxisRubric> = {
  argumentationScore: {
    question: (side) =>
      `How well does the debater on side ${side} support their own position with clear claims and reasons?`,
    focus: (side) =>
      `Judge only the turns in \`transcript\` and the items in \`argument_components\` whose \`side\` is ${side}. ` +
      `Judge the quality of the reasoning only: not whether the facts are true, and not how they responded to the opponent. ${SILENT_TURN_RULE}`,
    criteria: [
      'No real argument: no clear claim, only silent turns, or statements unrelated to the topic',
      'Claims are stated but unsupported: bare assertions, or reasons that do not connect to the claim',
      'Claims have some support, but the reasoning has clear gaps, leaps, or relies on vague generalities',
      'Clear claims backed by relevant reasons or evidence, with only minor gaps',
      'A clear, well-structured case: every main claim is backed by specific, relevant reasons or evidence that directly supports it',
    ],
  },
  interactionScore: {
    question: (side, opponent) =>
      `How directly does the debater on side ${side} engage with the claims and questions of side ${opponent}?`,
    focus: (side, opponent) =>
      `Use the turns in \`transcript\` and the items in \`argument_relations\`. ` +
      `Relations whose \`from_side\` is ${side} and \`to_side\` is ${opponent} with kind ATTACK or QUESTION are rebuttals and questions aimed at the opponent. ` +
      `Relations whose \`from_side\` is ${opponent} and \`to_side\` is ${side} with kind QUESTION are questions ${side} was expected to answer in a later turn. ${SILENT_TURN_RULE}`,
    criteria: [
      'Ignores the opponent entirely: no rebuttal and no answers, or skips the turns where a response was expected',
      "Refers to the opponent's position only vaguely, or evades the questions put to this side",
      "Responds to some of the opponent's points or questions, but leaves major claims or questions unaddressed",
      "Directly rebuts most of the opponent's main claims and answers most questions put to this side",
      'Directly engages every major opposing claim with targeted rebuttals and answers every question put to this side',
    ],
  },
  factualReliabilityScore: {
    question: (side) =>
      `How well are the factual claims made by the debater on side ${side} backed by the fact-check results?`,
    focus: (side) =>
      `Use only the items in \`argument_components\` whose \`side\` is ${side} and their \`fact_check\`. ` +
      `A \`fact_check\` of null means the claim was not checked; treat unchecked claims as neutral, not as errors.`,
    criteria: [
      'Several checked claims of this side are CONTRADICTED or OUTDATED, including claims central to its case',
      'At least one checked claim is CONTRADICTED or OUTDATED, and these problems outweigh the supported claims',
      'Neutral: this side has no checked claims, or its results are mixed, INSUFFICIENT_EVIDENCE, or NOT_VERIFIABLE',
      'Checked claims are mostly SUPPORTED or PARTIALLY_SUPPORTED, and none are CONTRADICTED',
      'Every checked claim of this side is SUPPORTED',
    ],
  },
};

const AXES = Object.keys(AXIS_RUBRICS) as ScoreAxis[];
const SIDES = [DebateSide.SIDE_A, DebateSide.SIDE_B] as const;

// 질문 id는 코드에서만 쓴다(모델에는 가지 않는다).
const questionId = (side: DebateSide, axis: ScoreAxis) => `${side}.${axis}`;

const opponentOf = (side: DebateSide) =>
  side === DebateSide.SIDE_A ? DebateSide.SIDE_B : DebateSide.SIDE_A;

@Injectable()
export class TypeSafeDebateScorer implements DebateScorer {
  private readonly logger = new Logger(TypeSafeDebateScorer.name);
  private readonly model: string;
  private readonly client: TypeSafeClient | null;

  constructor(
    configService: ConfigService,
    private readonly callLogger: LlmCallLogger,
  ) {
    this.model = configService.getOrThrow<string>('TYPESAFE_MODEL');

    const apiKey = configService.get<string>('TYPESAFE_API_KEY');
    if (!apiKey) {
      this.client = null;
      this.logger.warn('TYPESAFE_API_KEY가 없어 판정 점수를 매길 수 없습니다.');
      return;
    }
    this.client = new TypeSafeClient({
      apiKey,
      defaultModel: this.model,
      timeout: configService.getOrThrow<number>('TYPESAFE_TIMEOUT_MS'),
      retry: {
        maxRetries: configService.getOrThrow<number>('TYPESAFE_MAX_RETRIES'),
      },
    });
  }

  /**
   * 3단계 판정의 점수 부여(TypeSafe Jev). 피드백·위반은 만들지 않는다.
   * 편 2개 × 축 3개 = Score 질문 6개를 한 요청으로 보낸다. Jev는 state를 한 번 읽고 질문을
   * 병렬로 답하므로 질문을 나눠 보내는 것보다 빠르고 싸다. 질문은 서로의 답을 보지 못한다.
   */
  async score(request: DebateJudgeRequest): Promise<DebateScoreResult> {
    if (this.client === null) {
      // 키가 없는 상태는 재시도로 나아지지 않는다.
      throw new NonRetryableTaskError(
        'TYPESAFE_API_KEY가 없어 실행할 수 없습니다.',
      );
    }

    const client = this.client;
    const result = await this.callLogger.measure(
      {
        provider: 'typesafe',
        model: this.model,
        operation: 'judge.score',
        context: request.logContext,
      },
      () =>
        client.systemOne({
          state: buildScoringState(request),
          questions: buildScoreQuestions(),
        }),
      (response) => toTokenUsage(response.usage),
    );

    const answers = result.answers as Readonly<Record<string, ScoreResponse>>;
    this.logConfidence(request.logContext.debateId, answers);

    return {
      sideA: toSideScores(answers, DebateSide.SIDE_A),
      sideB: toSideScores(answers, DebateSide.SIDE_B),
      // 별칭(jev-latest)이 아니라 실제로 답한 버전 id를 남겨야 판정을 재현할 수 있다.
      model: result.model,
    };
  }

  // 축별 confidence는 임계값 튜닝·품질 점검용 관측 데이터다. 판정 흐름에는 쓰지 않는다.
  private logConfidence(
    debateId: string,
    answers: Readonly<Record<string, ScoreResponse>>,
  ): void {
    const fields = SIDES.flatMap((side) =>
      AXES.map((axis) => {
        const answer = answers[questionId(side, axis)];
        return `${side}.${axis}=${answer.score.toFixed(2)}(conf ${answer.confidence.toFixed(2)})`;
      }),
    );
    this.logger.debug(`Jev 채점: debateId=${debateId}, ${fields.join(', ')}`);
  }
}

// 축 3개 × 편 2개의 Score 질문. 편마다 같은 기준을 써야 두 편의 점수를 비교할 수 있다.
export function buildScoreQuestions(): Record<string, ScoreQuestion> {
  const questions: Record<string, ScoreQuestion> = {};
  for (const side of SIDES) {
    const opponent = opponentOf(side);
    for (const axis of AXES) {
      const rubric = AXIS_RUBRICS[axis];
      const instructions: EntryType = {
        question: rubric.question(side, opponent),
        target_side: side,
        focus: rubric.focus(side, opponent),
      };
      questions[questionId(side, axis)] = score(instructions, rubric.criteria);
    }
  }
  return questions;
}

/**
 * 판정 입력을 Jev의 state(JSON)로 만든다. 간선에 양끝의 편을 함께 실어 두는 것은
 * "누가 누구를 겨냥했는가"를 ref → 컴포넌트 → 편으로 두 번 따라가지 않게 하려는 것이다.
 */
export function buildScoringState(request: DebateJudgeRequest): {
  [key: string]: JsonValue;
} {
  const sideByRef = new Map(
    request.components.map((component) => [
      component.ref,
      component.speakerSide,
    ]),
  );

  return {
    topic: request.topic,
    sides: {
      [DebateSide.SIDE_A]: { nickname: request.sideANickname },
      [DebateSide.SIDE_B]: { nickname: request.sideBNickname },
    },
    transcript: request.turns.map((turn) => ({
      sequence: turn.sequence,
      phase: turn.phase,
      round: turn.round,
      side: turn.speakerSide,
      content: turn.content,
    })),
    argument_components: request.components.map((component) => ({
      ref: component.ref,
      side: component.speakerSide,
      kind: component.kind,
      statement: component.statement,
      fact_check:
        component.factCheck === null
          ? null
          : {
              status: component.factCheck.status,
              reason: component.factCheck.reason,
            },
    })),
    argument_relations: request.relations.map((relation) => ({
      from: relation.fromRef,
      from_side: sideByRef.get(relation.fromRef) ?? null,
      kind: relation.kind,
      to: relation.toRef,
      to_side: sideByRef.get(relation.toRef) ?? null,
    })),
  };
}

function toSideScores(
  answers: Readonly<Record<string, ScoreResponse>>,
  side: DebateSide,
): DebateSideScores {
  const scores = {} as DebateSideScores;
  for (const axis of AXES) {
    scores[axis] = toHundredScale(
      answers[questionId(side, axis)].score,
      AXIS_RUBRICS[axis].criteria.length,
    );
  }
  return scores;
}

/**
 * Jev의 score는 0~(단계 수 - 1) 사이의 확률 가중 위치다(단계 사이 값도 나온다).
 * 단계 수로 정규화해 0~100 정수로 펼친다. 범위 밖 값은 계약 위반이므로 경계로 자른다.
 */
export function toHundredScale(position: number, levels: number): number {
  const normalized = Math.min(Math.max(position / (levels - 1), 0), 1);
  return Math.round(MIN_SCORE + normalized * (MAX_SCORE - MIN_SCORE));
}

// TypeSafe는 입력 토큰만 과금하고 캐시·추론 토큰 개념이 없다.
function toTokenUsage(usage: Usage | undefined): LlmTokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? null,
    cachedTokens: null,
    outputTokens: usage?.output_tokens ?? null,
    thinkingTokens: null,
    totalTokens:
      usage === undefined ? null : usage.input_tokens + usage.output_tokens,
  };
}
