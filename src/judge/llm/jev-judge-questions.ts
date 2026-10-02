import type {
  ChoiceQuestion,
  EntryType,
  Question,
  ResultFor,
  ScoreQuestion,
} from '@typesafe-ai/sdk';
import { DebateSide } from '../../debates/debate-turn';
import { MAX_SCORE, MIN_SCORE } from '../debate-judge.service';
import { SIDE_PLACEHOLDERS } from '../judgment-text';
import {
  DebateViolation,
  ViolationSeverity,
  ViolationType,
} from '../judge.types';
import {
  DebateJudgeRequest,
  DebateScoring,
  JudgeTranscriptTurn,
  SideScoring,
  SILENT_TURN_PLACEHOLDER,
} from './judge-llm';

export type JevQuestions = Record<string, Question>;
export type JevAnswers = Readonly<Record<string, ResultFor<Question>>>;

const SIDES = [DebateSide.SIDE_A, DebateSide.SIDE_B] as const;

type ScoreAxis = keyof Pick<
  SideScoring,
  'argumentationScore' | 'interactionScore' | 'factualReliabilityScore'
>;

/**
 * 축별 평가 기준. 레벨은 낮은 쪽부터 높은 쪽 순서이고, 각 레벨은 따로 읽혀도 뜻이 통하도록 구체적으로 쓴다.
 * 응답 score(0~레벨 수-1, 확률 가중 평균)는 toScaledScore가 MIN_SCORE~MAX_SCORE 정수로 옮긴다.
 */
const SCORE_RUBRICS: Record<
  ScoreAxis,
  { instructions: string; criteria: readonly [string, string, ...string[]] }
> = {
  argumentationScore: {
    instructions:
      'How strong is the argumentation of {side}? Judge from `transcript` and `argument_components` whether the claims are clear and whether the evidence actually supports them.',
    criteria: [
      'No claim is made, or it is impossible to tell what is being claimed. There is no evidence.',
      'Claims are made, but there is little evidence, or the evidence barely connects to the claims.',
      'Claims and evidence are present, but the evidence supports only some claims or there are noticeable gaps in the reasoning.',
      'Claims are clear and relevant evidence supports most of them. Only minor gaps remain.',
      'Claims are very clear and every key claim is firmly supported by specific, relevant evidence.',
    ],
  },
  interactionScore: {
    instructions:
      "How well did {side} engage with the opponent? Consider whether {side} responded directly to the opponent's claims and answered the questions it received. Use as evidence whether the ATTACK and QUESTION relations in `argument_relations` actually target the opposing side's components, and whether questions received are followed by answers later.",
    criteria: [
      "Did not respond to the opponent's claims or questions at all; only stated its own points.",
      'Mentions the opponent but misses the point, or leaves most questions unanswered.',
      "Responded directly to some of the opponent's claims but missed important claims or questions.",
      "Responded directly to most of the opponent's main claims and answered most questions received.",
      "Accurately targeted and rebutted all of the opponent's key claims and answered every question received.",
    ],
  },
  factualReliabilityScore: {
    instructions:
      'How reliable are the factual claims made by {side}? Base the judgment on `fact_check` (the verification result) in `argument_components`. Treat claims without a verification result as neutral.',
    criteria: [
      'Most key factual claims are contradicted by the verification results (CONTRADICTED) or are outdated.',
      'Among the factual claims, more are contradicted than supported.',
      'Supported and unsupported claims are mixed, or there are almost no verified factual claims, so the result is neutral.',
      'Most factual claims are supported, and any contradicted ones are minor.',
      'All verified factual claims are supported (SUPPORTED) and none are contradicted.',
    ],
  },
};

const VIOLATION_DESCRIPTIONS: Record<ViolationType, string> = {
  profanity: 'profanity or vulgar language (profanity)',
  personal_attack:
    "a personal attack that targets the opponent's character, ability, or background instead of their argument (personal_attack)",
  disrespect:
    'a disrespectful attitude such as mockery, sarcasm, or dismissiveness (disrespect)',
  off_topic:
    'remarks unrelated to the debate topic that steer the debate off course (off_topic)',
  threat: 'threats or intimidation toward the opponent (threat)',
};

const VIOLATION_TYPES = Object.keys(VIOLATION_DESCRIPTIONS) as ViolationType[];

// 위반 정도. 'none'은 위반 없음이라 DebateViolation으로 옮기지 않는다.
const SEVERITY_CRITERIA: Record<ViolationSeverity | 'none', string> = {
  none: 'Nothing of this kind occurs at all.',
  minor:
    'Mild rudeness or a single minor breach of manners that has no real effect on how the debate proceeds.',
  moderate:
    'Clearly rude wording, a mild personal attack, or a single instance of profanity.',
  high: 'Clear profanity or a strong personal attack, remarks that directly insult the opponent, or repeated rudeness.',
  severe:
    'Serious insults or threats, persistent and repeated profanity or personal attacks, or rule violations severe enough to effectively disrupt the debate.',
};

// 질문 id는 코드에서만 쓰고 모델에는 가지 않는다(문서: question id is not sent to the model).
export const questionKeys = {
  score: (side: DebateSide, axis: ScoreAxis) => `${side}.score.${axis}`,
  severity: (side: DebateSide, type: ViolationType) =>
    `${side}.violation.${type}.severity`,
  evidence: (side: DebateSide, type: ViolationType) =>
    `${side}.violation.${type}.evidence`,
};

const turnRef = (turn: JudgeTranscriptTurn) => `t${turn.sequence}`;

// 시간 초과로 말하지 않은 차례는 위반의 근거가 될 수 없다.
function spokenTurnsOf(
  request: DebateJudgeRequest,
  side: DebateSide,
): JudgeTranscriptTurn[] {
  return request.turns.filter(
    (turn) =>
      turn.speakerSide === side && turn.content !== SILENT_TURN_PLACEHOLDER,
  );
}

/**
 * Jev에 보낼 state. 기존 판정 프롬프트(buildJudgeInput)와 같은 정보를 이름 붙은 JSON 필드로 담는다.
 * 참여자는 어디서나 placeholder로만 표기하고, 닉네임은 발언 속 호칭을 이해하는 데만 쓰도록 범례에 한 번 둔다.
 */
export function buildJevState(request: DebateJudgeRequest): EntryType {
  return {
    topic: request.topic,
    participants: SIDES.map((side) => ({
      label: SIDE_PLACEHOLDERS[side],
      nickname:
        side === DebateSide.SIDE_A
          ? request.sideANickname
          : request.sideBNickname,
    })),
    silent_turn_marker: `${SILENT_TURN_PLACEHOLDER} marks a turn in which the speaker said nothing within the time limit. Do not interpret it in that side's favor.`,
    transcript: request.turns.map((turn) => ({
      ref: turnRef(turn),
      speaker: SIDE_PLACEHOLDERS[turn.speakerSide],
      phase: turn.phase,
      round: turn.round,
      content: turn.content,
    })),
    argument_components: request.components.map((component) => ({
      ref: component.ref,
      speaker: SIDE_PLACEHOLDERS[component.speakerSide],
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
      to: relation.toRef,
      kind: relation.kind,
    })),
  };
}

/**
 * 한 번의 호출로 보낼 질문 전체. 편마다 점수 3축 + 위반 5종의 정도 + 위반 5종의 근거 발언이다.
 * 근거 발언은 "위반했다면 어느 발언인가"를 미리 묻는 투기적 질문이라, 정도가 none이면 답을 버린다.
 * 질문끼리 서로의 답을 보지 못하므로 위반 여부를 전제로 깔아 두어야 한다.
 */
export function buildJevQuestions(request: DebateJudgeRequest): JevQuestions {
  const questions: JevQuestions = {};

  for (const side of SIDES) {
    const label = SIDE_PLACEHOLDERS[side];

    for (const [axis, rubric] of Object.entries(SCORE_RUBRICS) as [
      ScoreAxis,
      (typeof SCORE_RUBRICS)[ScoreAxis],
    ][]) {
      const question: ScoreQuestion = {
        type: 'score',
        instructions: rubric.instructions.replace('{side}', label),
        criteria: rubric.criteria,
      };
      questions[questionKeys.score(side, axis)] = question;
    }

    const spokenTurns = spokenTurnsOf(request, side);
    // 한 번도 말하지 않은 편은 위반할 수 없으므로 묻지 않는다.
    if (spokenTurns.length === 0) {
      continue;
    }

    for (const type of VIOLATION_TYPES) {
      const severity: ChoiceQuestion = {
        type: 'choice',
        instructions: `Do the turns in \`transcript\` whose speaker is ${label} contain ${VIOLATION_DESCRIPTIONS[type]}? If so, how severe is it? Do not invent violations that are not there.`,
        criteria: SEVERITY_CRITERIA,
      };
      questions[questionKeys.severity(side, type)] = severity;

      // 후보가 하나뿐이면 고를 것이 없다 — toDebateScoring이 그 발언을 바로 쓴다.
      if (spokenTurns.length < 2) {
        continue;
      }
      const evidence: ChoiceQuestion = {
        type: 'choice',
        instructions: `Assume ${label} committed ${VIOLATION_DESCRIPTIONS[type]}. Which turn by ${label} is the clearest evidence of it? Each option is a ref in \`transcript\`.`,
        criteria: Object.fromEntries(
          spokenTurns.map((turn) => [
            turnRef(turn),
            `The turn in \`transcript\` whose ref is ${turnRef(turn)}`,
          ]),
        ),
      };
      questions[questionKeys.evidence(side, type)] = evidence;
    }
  }

  return questions;
}

// Score 응답(0~topLevel 사이 실수)을 판정 점수 범위의 정수로 옮긴다.
export function toScaledScore(score: number, topLevel: number): number {
  const ratio = Math.min(Math.max(score / topLevel, 0), 1);
  return Math.round(MIN_SCORE + ratio * (MAX_SCORE - MIN_SCORE));
}

// Jev 응답을 도메인 계약으로 옮긴다. 질문을 만든 request를 그대로 넘겨야 근거 발언 원문을 찾을 수 있다.
export function toDebateScoring(
  request: DebateJudgeRequest,
  answers: JevAnswers,
  model: string,
): DebateScoring {
  const [sideA, sideB] = SIDES.map((side) =>
    toSideScoring(request, answers, side),
  );
  return { sideA, sideB, model };
}

function toSideScoring(
  request: DebateJudgeRequest,
  answers: JevAnswers,
  side: DebateSide,
): SideScoring {
  const scoreOf = (axis: ScoreAxis) => {
    const answer = answerOf(answers, questionKeys.score(side, axis), 'score');
    return toScaledScore(answer.score, SCORE_RUBRICS[axis].criteria.length - 1);
  };

  return {
    argumentationScore: scoreOf('argumentationScore'),
    interactionScore: scoreOf('interactionScore'),
    factualReliabilityScore: scoreOf('factualReliabilityScore'),
    violations: toViolations(request, answers, side),
  };
}

function toViolations(
  request: DebateJudgeRequest,
  answers: JevAnswers,
  side: DebateSide,
): DebateViolation[] {
  const spokenTurns = spokenTurnsOf(request, side);
  if (spokenTurns.length === 0) {
    return [];
  }

  return VIOLATION_TYPES.flatMap((type) => {
    const severity = answerOf(
      answers,
      questionKeys.severity(side, type),
      'choice',
    ).choice as ViolationSeverity | 'none';
    if (severity === 'none') {
      return [];
    }

    // 근거 질문은 후보가 둘 이상일 때만 보냈다. 하나뿐이면 그 발언이 근거다.
    const evidenceTurn =
      spokenTurns.length < 2
        ? spokenTurns[0]
        : spokenTurns.find(
            (turn) =>
              turnRef(turn) ===
              answerOf(answers, questionKeys.evidence(side, type), 'choice')
                .choice,
          );
    if (evidenceTurn === undefined) {
      throw new Error(`${side} ${type} 위반의 근거 발언을 찾지 못했습니다.`);
    }

    return [{ type, severity, evidence: evidenceTurn.content }];
  });
}

// 응답이 빠졌거나 질문과 다른 타입이면 스키마를 지키지 못한 것이므로 재시도 대상으로 올린다.
function answerOf<T extends ResultFor<Question>['type']>(
  answers: JevAnswers,
  key: string,
  type: T,
): Extract<ResultFor<Question>, { type: T }> {
  const answer = answers[key];
  if (answer === undefined || answer.type !== type) {
    throw new Error(`Jev 응답에 ${key}(${type}) 답이 없습니다.`);
  }
  return answer as Extract<ResultFor<Question>, { type: T }>;
}
