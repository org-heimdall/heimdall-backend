import type { Question, ResultFor } from '@typesafe-ai/sdk';
import { DebatePhase, DebateSide } from '../../debates/debate-turn';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  VerificationStatus,
} from '../judge.types';
import {
  buildJevQuestions,
  buildJevState,
  JevAnswers,
  questionKeys,
  toDebateScoring,
  toScaledScore,
} from './jev-judge-questions';
import {
  DebateJudgeRequest,
  JudgeTranscriptTurn,
  SILENT_TURN_PLACEHOLDER,
} from './judge-llm';

const AXES = [
  'argumentationScore',
  'interactionScore',
  'factualReliabilityScore',
] as const;
const VIOLATION_TYPES = [
  'profanity',
  'personal_attack',
  'disrespect',
  'off_topic',
  'threat',
] as const;

const turn = (
  sequence: number,
  speakerSide: DebateSide,
  content: string,
): JudgeTranscriptTurn => ({
  sequence,
  phase: DebatePhase.OPENING,
  round: 1,
  speakerSide,
  speakerNickname: speakerSide === DebateSide.SIDE_A ? '테테스트' : 'tester',
  content,
});

const buildRequest = (turns: JudgeTranscriptTurn[]): DebateJudgeRequest => ({
  topic: '한국은 자체 핵무장을 해야 한다',
  sideANickname: '테테스트',
  sideBNickname: 'tester',
  turns,
  components: [
    {
      ref: '#1',
      speakerSide: DebateSide.SIDE_A,
      kind: ArgumentComponentKind.EVIDENCE,
      statement: '국민의 70%가 핵무장에 찬성한다.',
      factCheck: { status: VerificationStatus.SUPPORTED, reason: '조사 확인' },
    },
  ],
  relations: [
    { fromRef: '#2', toRef: '#1', kind: ArgumentRelationKind.ATTACK },
  ],
  logContext: { debateId: 'debate-1' },
});

const scoreAnswer = (score: number): ResultFor<Question> => ({
  type: 'score',
  score,
  confidence: 0.9,
  legend: {},
  probabilities: {},
});

const choiceAnswer = (choice: string): ResultFor<Question> => ({
  type: 'choice',
  choice,
  confidence: 0.9,
  probabilities: { [choice]: 1 },
});

// 질문 전체에 기본 답(점수 2, 위반 none, 근거는 첫 후보)을 채우고 overrides로 덮는다.
const answerAll = (
  request: DebateJudgeRequest,
  overrides: Record<string, ResultFor<Question>> = {},
): JevAnswers => {
  const answers: Record<string, ResultFor<Question>> = {};
  for (const [key, question] of Object.entries(buildJevQuestions(request))) {
    if (question.type === 'score') {
      answers[key] = scoreAnswer(2);
    } else if (question.type === 'choice') {
      answers[key] = key.endsWith('.severity')
        ? choiceAnswer('none')
        : choiceAnswer(Object.keys(question.criteria)[0]);
    }
  }
  return { ...answers, ...overrides };
};

describe('jev-judge-questions', () => {
  describe('toScaledScore', () => {
    it.each([
      [0, 4, 0],
      [4, 4, 100],
      [2, 4, 50],
      [1.43, 4, 36],
      // 응답이 범위를 벗어나도 판정 점수 범위로 자른다.
      [-0.1, 4, 0],
      [4.2, 4, 100],
    ])('score=%s, topLevel=%s → %s', (score, topLevel, expected) => {
      expect(toScaledScore(score, topLevel)).toBe(expected);
    });

    it('항상 정수를 돌려준다', () => {
      expect(Number.isInteger(toScaledScore(1.234, 4))).toBe(true);
    });
  });

  describe('buildJevState', () => {
    it('참여자는 placeholder로만 표기하고 닉네임은 범례에만 둔다', () => {
      const request = buildRequest([
        turn(1, DebateSide.SIDE_A, '찬성합니다'),
        turn(2, DebateSide.SIDE_B, '반대합니다'),
      ]);

      const state = buildJevState(request) as Record<string, unknown>;

      expect(state.participants).toEqual([
        { label: '{{SIDE_A}}', nickname: '테테스트' },
        { label: '{{SIDE_B}}', nickname: 'tester' },
      ]);
      expect(state.transcript).toEqual([
        expect.objectContaining({ ref: 't1', speaker: '{{SIDE_A}}' }),
        expect.objectContaining({ ref: 't2', speaker: '{{SIDE_B}}' }),
      ]);
      expect(JSON.stringify(state)).not.toContain('"SIDE_A"');
    });
  });

  describe('buildJevQuestions', () => {
    it('편마다 점수 3축, 위반 5종의 정도와 근거 발언을 묻는다', () => {
      const request = buildRequest([
        turn(1, DebateSide.SIDE_A, 'A 첫 발언'),
        turn(2, DebateSide.SIDE_B, 'B 첫 발언'),
        turn(3, DebateSide.SIDE_A, 'A 두 번째 발언'),
        turn(4, DebateSide.SIDE_B, 'B 두 번째 발언'),
      ]);

      const questions = buildJevQuestions(request);

      expect(Object.keys(questions)).toHaveLength(2 * (3 + 5 + 5));
      const evidence = questions[
        questionKeys.evidence(DebateSide.SIDE_A, 'threat')
      ] as { criteria: Record<string, unknown> };
      expect(Object.keys(evidence.criteria)).toEqual(['t1', 't3']);
    });

    it('말하지 않은 차례는 근거 후보에서 빼고, 후보가 하나면 근거를 묻지 않는다', () => {
      const request = buildRequest([
        turn(1, DebateSide.SIDE_A, 'A 발언'),
        turn(2, DebateSide.SIDE_B, 'B 발언'),
        turn(3, DebateSide.SIDE_A, SILENT_TURN_PLACEHOLDER),
      ]);

      const questions = buildJevQuestions(request);

      for (const type of VIOLATION_TYPES) {
        expect(
          questions[questionKeys.severity(DebateSide.SIDE_A, type)],
        ).toBeDefined();
        expect(
          questions[questionKeys.evidence(DebateSide.SIDE_A, type)],
        ).toBeUndefined();
      }
    });

    it('한 번도 말하지 않은 편에는 위반을 묻지 않는다', () => {
      const request = buildRequest([
        turn(1, DebateSide.SIDE_A, 'A 발언'),
        turn(2, DebateSide.SIDE_B, SILENT_TURN_PLACEHOLDER),
      ]);

      const keys = Object.keys(buildJevQuestions(request));

      expect(keys.filter((key) => key.startsWith('SIDE_B.'))).toEqual(
        AXES.map((axis) => questionKeys.score(DebateSide.SIDE_B, axis)),
      );
    });
  });

  describe('toDebateScoring', () => {
    const request = buildRequest([
      turn(1, DebateSide.SIDE_A, 'A 첫 발언'),
      turn(2, DebateSide.SIDE_B, 'B 첫 발언'),
      turn(3, DebateSide.SIDE_A, '이 멍청한 놈아'),
      turn(4, DebateSide.SIDE_B, 'B 두 번째 발언'),
    ]);

    it('Score 응답을 0~100 정수 점수로 옮긴다', () => {
      const answers = answerAll(request, {
        [questionKeys.score(DebateSide.SIDE_A, 'argumentationScore')]:
          scoreAnswer(3),
        [questionKeys.score(DebateSide.SIDE_B, 'interactionScore')]:
          scoreAnswer(0.5),
      });

      const scoring = toDebateScoring(request, answers, 'jev-1.13.0');

      expect(scoring.model).toBe('jev-1.13.0');
      expect(scoring.sideA).toMatchObject({
        argumentationScore: 75,
        interactionScore: 50,
        factualReliabilityScore: 50,
        violations: [],
      });
      expect(scoring.sideB.interactionScore).toBe(13);
    });

    it('none이 아닌 위반만 담고, 고른 발언의 원문을 근거로 붙인다', () => {
      const answers = answerAll(request, {
        [questionKeys.severity(DebateSide.SIDE_A, 'personal_attack')]:
          choiceAnswer('high'),
        [questionKeys.evidence(DebateSide.SIDE_A, 'personal_attack')]:
          choiceAnswer('t3'),
        // 정도가 none이면 근거 답은 버린다.
        [questionKeys.evidence(DebateSide.SIDE_B, 'threat')]:
          choiceAnswer('t4'),
      });

      const scoring = toDebateScoring(request, answers, 'jev-1.13.0');

      expect(scoring.sideA.violations).toEqual([
        {
          type: 'personal_attack',
          severity: 'high',
          evidence: '이 멍청한 놈아',
        },
      ]);
      expect(scoring.sideB.violations).toEqual([]);
    });

    it('근거 후보가 하나면 그 발언을 근거로 쓴다', () => {
      const single = buildRequest([
        turn(1, DebateSide.SIDE_A, '꺼져'),
        turn(2, DebateSide.SIDE_B, 'B 발언'),
      ]);
      const answers = answerAll(single, {
        [questionKeys.severity(DebateSide.SIDE_A, 'profanity')]:
          choiceAnswer('moderate'),
      });

      const scoring = toDebateScoring(single, answers, 'jev-1.13.0');

      expect(scoring.sideA.violations).toEqual([
        { type: 'profanity', severity: 'moderate', evidence: '꺼져' },
      ]);
    });

    it('응답에 답이 빠졌거나 타입이 다르면 던진다(재시도 대상)', () => {
      const key = questionKeys.score(DebateSide.SIDE_A, 'argumentationScore');
      const missing = { ...answerAll(request) };
      delete (missing as Record<string, unknown>)[key];

      expect(() => toDebateScoring(request, missing, 'jev')).toThrow(key);
      expect(() =>
        toDebateScoring(
          request,
          answerAll(request, { [key]: choiceAnswer('none') }),
          'jev',
        ),
      ).toThrow(key);
    });

    it('후보에 없는 발언을 근거로 고르면 던진다', () => {
      const answers = answerAll(request, {
        [questionKeys.severity(DebateSide.SIDE_A, 'threat')]:
          choiceAnswer('minor'),
        [questionKeys.evidence(DebateSide.SIDE_A, 'threat')]:
          choiceAnswer('t99'),
      });

      expect(() => toDebateScoring(request, answers, 'jev')).toThrow(
        '근거 발언',
      );
    });
  });
});
