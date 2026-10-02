import { ConfigService } from '@nestjs/config';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import type { ScoreQuestion } from '@typesafe-ai/sdk';
import { DebatePhase, DebateSide } from '../../debates/debate-turn';
import { NonRetryableTaskError } from '../judge-task.worker';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  VerificationStatus,
} from '../judge.types';
import type { DebateJudgeRequest } from './judge-llm';
import { LlmCallLogger } from './llm-call-logger';
import {
  AXIS_RUBRICS,
  buildScoreQuestions,
  buildScoringState,
  toHundredScale,
  TypeSafeDebateScorer,
} from './typesafe-debate-scorer';

// score() 같은 질문 생성 함수는 실제 것을 쓰고, 네트워크를 타는 클라이언트만 바꾼다.
jest.mock('@typesafe-ai/sdk', () => ({
  ...jest.requireActual<typeof import('@typesafe-ai/sdk')>('@typesafe-ai/sdk'),
  TypeSafeClient: jest.fn(),
}));

describe('TypeSafeDebateScorer', () => {
  const request: DebateJudgeRequest = {
    topic: 'AI 규제, 필요한가?',
    sideANickname: '메시',
    sideBNickname: '호날두',
    turns: [
      {
        sequence: 1,
        phase: DebatePhase.OPENING,
        round: 1,
        speakerSide: DebateSide.SIDE_A,
        speakerNickname: '메시',
        content: '규제가 필요하다',
      },
      {
        sequence: 2,
        phase: DebatePhase.OPENING,
        round: 1,
        speakerSide: DebateSide.SIDE_B,
        speakerNickname: '호날두',
        content: '(발언 없음)',
      },
    ],
    components: [
      {
        ref: '#1',
        speakerSide: DebateSide.SIDE_A,
        kind: ArgumentComponentKind.CLAIM,
        statement: 'AI 사고가 늘고 있다',
        factCheck: {
          status: VerificationStatus.SUPPORTED,
          reason: '통계 일치',
        },
      },
      {
        ref: '#2',
        speakerSide: DebateSide.SIDE_B,
        kind: ArgumentComponentKind.REBUTTAL,
        statement: '규제는 혁신을 막는다',
        factCheck: null,
      },
    ],
    relations: [
      { fromRef: '#2', toRef: '#1', kind: ArgumentRelationKind.ATTACK },
      // 재분석 등으로 끝점이 사라진 간선이 섞여 와도 편은 null로 둔다.
      { fromRef: '#2', toRef: '#9', kind: ArgumentRelationKind.QUESTION },
    ],
    logContext: { debateId: 'debate-uuid' },
  };

  const CONFIG: Record<string, unknown> = {
    TYPESAFE_API_KEY: 'ts-test',
    TYPESAFE_MODEL: 'jev-1.13.0',
    TYPESAFE_TIMEOUT_MS: 30000,
    TYPESAFE_MAX_RETRIES: 2,
  };

  const buildConfig = (overrides: Record<string, unknown> = {}) => {
    const values = { ...CONFIG, ...overrides };
    return {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        const value = values[key];
        if (value === undefined) {
          throw new Error(`missing: ${key}`);
        }
        return value;
      },
    } as unknown as ConfigService;
  };

  // 실제 호출을 그대로 실행하는 측정기. 로깅 자체는 LlmCallLogger 테스트의 몫이다.
  const callLogger = {
    measure: jest.fn(
      async <T>(_meta: unknown, call: () => Promise<T>): Promise<T> => call(),
    ),
  } as unknown as LlmCallLogger;

  const scoreAnswer = (score: number) => ({
    type: 'score',
    score,
    confidence: 1,
    legend: {},
    probabilities: {},
  });

  let systemOne: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    systemOne = jest.fn().mockResolvedValue({
      model: 'jev-1.13.0',
      usage: { input_tokens: 1200, output_tokens: 60 },
      answers: {
        'SIDE_A.argumentationScore': scoreAnswer(3),
        'SIDE_A.interactionScore': scoreAnswer(2.5),
        'SIDE_A.factualReliabilityScore': scoreAnswer(4),
        'SIDE_B.argumentationScore': scoreAnswer(1.24),
        'SIDE_B.interactionScore': scoreAnswer(0),
        'SIDE_B.factualReliabilityScore': scoreAnswer(2),
      },
    });
    (TypeSafeClient as unknown as jest.Mock).mockImplementation(() => ({
      systemOne,
    }));
  });

  describe('score', () => {
    it('편별 세 축의 Jev 점수를 0~100 정수로 환산하고 답한 모델 버전을 돌려준다', async () => {
      const scorer = new TypeSafeDebateScorer(buildConfig(), callLogger);

      const result = await scorer.score(request);

      expect(result).toEqual({
        sideA: {
          argumentationScore: 75,
          interactionScore: 63,
          factualReliabilityScore: 100,
        },
        sideB: {
          // 1.24 / 4 * 100 = 31
          argumentationScore: 31,
          interactionScore: 0,
          factualReliabilityScore: 50,
        },
        model: 'jev-1.13.0',
      });
    });

    it('질문 6개를 한 요청으로 보낸다', async () => {
      const scorer = new TypeSafeDebateScorer(buildConfig(), callLogger);

      await scorer.score(request);

      expect(systemOne).toHaveBeenCalledTimes(1);
      const [payload] = systemOne.mock.calls[0] as [
        { state: unknown; questions: Record<string, unknown> },
      ];
      expect(Object.keys(payload.questions)).toHaveLength(6);
      expect(payload.state).toEqual(buildScoringState(request));
    });

    it('설정한 모델·시간 제한·재시도로 클라이언트를 만든다', () => {
      new TypeSafeDebateScorer(buildConfig(), callLogger);

      expect(TypeSafeClient).toHaveBeenCalledWith({
        apiKey: 'ts-test',
        defaultModel: 'jev-1.13.0',
        timeout: 30000,
        retry: { maxRetries: 2 },
      });
    });

    it('API 키가 없으면 재시도 없이 실패한다', async () => {
      const scorer = new TypeSafeDebateScorer(
        buildConfig({ TYPESAFE_API_KEY: '' }),
        callLogger,
      );

      await expect(scorer.score(request)).rejects.toBeInstanceOf(
        NonRetryableTaskError,
      );
      expect(TypeSafeClient).not.toHaveBeenCalled();
    });

    it('TypeSafe 호출이 실패하면 그대로 전파해 작업 재시도로 넘긴다', async () => {
      systemOne.mockRejectedValue(new Error('503'));
      const scorer = new TypeSafeDebateScorer(buildConfig(), callLogger);

      await expect(scorer.score(request)).rejects.toThrow('503');
    });
  });

  describe('buildScoreQuestions', () => {
    it('편마다 같은 기준으로 축별 Score 질문을 만들고 질문에 대상 편을 적는다', () => {
      const questions = buildScoreQuestions();

      const sideA = questions['SIDE_A.interactionScore'] as ScoreQuestion & {
        instructions: { target_side: string; question: string };
      };
      const sideB = questions['SIDE_B.interactionScore'] as ScoreQuestion & {
        instructions: { target_side: string; question: string };
      };
      expect(sideA.type).toBe('score');
      expect(sideA.criteria).toEqual(AXIS_RUBRICS.interactionScore.criteria);
      expect(sideB.criteria).toEqual(sideA.criteria);
      expect(sideA.instructions.target_side).toBe(DebateSide.SIDE_A);
      expect(sideA.instructions.question).toContain('side SIDE_A');
      expect(sideA.instructions.question).toContain('side SIDE_B');
      expect(sideB.instructions.target_side).toBe(DebateSide.SIDE_B);
    });
  });

  describe('buildScoringState', () => {
    it('간선에 양끝 편을 함께 싣고, 끝점이 없으면 편을 null로 둔다', () => {
      const state = buildScoringState(request);

      expect(state.argument_relations).toEqual([
        {
          from: '#2',
          from_side: DebateSide.SIDE_B,
          kind: ArgumentRelationKind.ATTACK,
          to: '#1',
          to_side: DebateSide.SIDE_A,
        },
        {
          from: '#2',
          from_side: DebateSide.SIDE_B,
          kind: ArgumentRelationKind.QUESTION,
          to: '#9',
          to_side: null,
        },
      ]);
    });

    it('검증 결과가 없는 컴포넌트는 fact_check를 null로 싣는다', () => {
      const state = buildScoringState(request);

      expect(state.argument_components).toEqual([
        {
          ref: '#1',
          side: DebateSide.SIDE_A,
          kind: ArgumentComponentKind.CLAIM,
          statement: 'AI 사고가 늘고 있다',
          fact_check: {
            status: VerificationStatus.SUPPORTED,
            reason: '통계 일치',
          },
        },
        {
          ref: '#2',
          side: DebateSide.SIDE_B,
          kind: ArgumentComponentKind.REBUTTAL,
          statement: '규제는 혁신을 막는다',
          fact_check: null,
        },
      ]);
    });
  });

  describe('toHundredScale', () => {
    it.each([
      [0, 5, 0],
      [2, 5, 50],
      [4, 5, 100],
      [1.5, 3, 75],
      // 계약 밖 값은 경계로 자른다.
      [-0.1, 5, 0],
      [4.2, 5, 100],
    ])('위치 %p (단계 %p개) → %p점', (position, levels, expected) => {
      expect(toHundredScale(position, levels)).toBe(expected);
    });
  });
});
