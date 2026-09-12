import { Repository } from 'typeorm';
import { DebatePhase, DebateSide } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { MembersService } from '../members/members.service';
import {
  calculateTotalScore,
  DebateJudgeService,
  decideWinner,
  JudgmentScoreValidationError,
  SCORE_WEIGHTS,
  SOCIAL_CREDIT_PENALTY,
  toSocialCreditPenalty,
} from './debate-judge.service';
import { NonRetryableTaskError } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  JudgeTaskKind,
  JudgeTaskStatus,
  DebateViolation,
  JudgmentWinner,
  VerificationStatus,
  ViolationSeverity,
  ViolationType,
} from './judge.types';
import {
  DebateArgumentComponent,
  DebateArgumentRelation,
} from './entities/debate-argument.entity';
import { DebateFactCheckResult } from './entities/debate-fact-check.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { SILENT_TURN_PLACEHOLDER } from './llm/judge-llm';
import type { DebateJudgeRequest, DebateJudgeResult } from './llm/judge-llm';

describe('DebateJudgeService', () => {
  const DEBATE_ID = 'debate-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  // 저장소가 트랜잭션 안에서 넘겨주는 manager 자리.
  const MANAGER = { id: 'entity-manager' };

  let judge: { judge: jest.Mock };
  let messages: { find: jest.Mock };
  let results: {
    findComponents: jest.Mock;
    findFactChecks: jest.Mock;
    findRelations: jest.Mock;
    completeJudgment: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock };
  let members: { deductSocialCredit: jest.Mock };
  let service: DebateJudgeService;

  const task = Object.assign(new JudgeTask(), {
    id: 'task-uuid',
    debateId: DEBATE_ID,
    kind: JudgeTaskKind.JUDGE,
    targetId: DEBATE_ID,
    status: JudgeTaskStatus.PROCESSING,
    attempt: 1,
    maxAttempts: 2,
  });

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      topic: 'AI 규제, 필요한가?',
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      // N=0 → OPENING(A,B) → CLOSING(A,B) 4턴
      rebuttalQuestionRounds: 0,
      ...overrides,
    });

  const buildMessage = (
    sequence: number,
    memberId: string,
    body: string | null,
  ): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: `turn-${sequence}`,
      debateId: DEBATE_ID,
      memberId,
      body,
      sequence,
      createdAt: new Date(),
    });

  // 논증 70/70/70, 상호작용 60/80 → 총점 A 67, B 73
  const judgment = (
    overrides: Partial<DebateJudgeResult> = {},
  ): DebateJudgeResult => ({
    sideA: {
      argumentationScore: 70,
      interactionScore: 60,
      factualReliabilityScore: 70,
      feedback: 'A 피드백',
      violations: [],
    },
    sideB: {
      argumentationScore: 70,
      interactionScore: 80,
      factualReliabilityScore: 70,
      feedback: 'B 피드백',
      violations: [],
    },
    overallReason: '총평',
    model: 'gpt-5.6-luna',
    ...overrides,
  });

  beforeEach(() => {
    judge = { judge: jest.fn().mockResolvedValue(judgment()) };
    messages = {
      find: jest
        .fn()
        .mockResolvedValue([
          buildMessage(1, HOST_ID, '규제가 필요하다'),
          buildMessage(2, OPPONENT_ID, ''),
        ]),
    };
    results = {
      findComponents: jest.fn().mockResolvedValue([]),
      findFactChecks: jest.fn().mockResolvedValue([]),
      findRelations: jest.fn().mockResolvedValue([]),
      // 저장소가 트랜잭션 안에서 부수 작업을 부르는 것까지 재현한다.
      completeJudgment: jest
        .fn()
        .mockImplementation(
          async (
            _input: unknown,
            withinTransaction: (manager: unknown) => Promise<void>,
          ) => {
            await withinTransaction(MANAGER);
          },
        ),
    };
    members = { deductSocialCredit: jest.fn().mockResolvedValue(undefined) };
    debates = { findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()) };

    service = new DebateJudgeService(
      judge,
      messages as unknown as Repository<DebateMessage>,
      results as unknown as JudgeResultRepository,
      debates as unknown as DebatesService,
      members as unknown as MembersService,
    );
  });

  it('총점은 서버가 가중합으로 계산하고 승자도 서버가 정한다', async () => {
    await service.handle(task);

    expect(results.completeJudgment).toHaveBeenCalledWith(
      expect.objectContaining({
        debateId: DEBATE_ID,
        // 70*0.4 + 60*0.3 + 70*0.3 = 67
        sideATotalScore: 67,
        // 70*0.4 + 80*0.3 + 70*0.3 = 73
        sideBTotalScore: 73,
        winner: JudgmentWinner.SIDE_B,
        winnerId: OPPONENT_ID,
      }),
      expect.any(Function),
    );
  });

  it('총점이 같으면 무승부이고 승자 id는 비운다', async () => {
    judge.judge.mockResolvedValue(
      judgment({
        sideB: {
          argumentationScore: 70,
          interactionScore: 60,
          factualReliabilityScore: 70,
          feedback: 'B 피드백',
          violations: [],
        },
      }),
    );

    await service.handle(task);

    expect(results.completeJudgment).toHaveBeenCalledWith(
      expect.objectContaining({
        winner: JudgmentWinner.DRAW,
        winnerId: null,
      }),
      expect.any(Function),
    );
  });

  it('시간 초과로 비어 있는 턴은 전사에 "(발언 없음)"으로 남는다(J3)', async () => {
    await service.handle(task);

    const [request] = judge.judge.mock.calls[0] as [DebateJudgeRequest];
    expect(request.turns).toEqual([
      expect.objectContaining({
        sequence: 1,
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.OPENING,
        content: '규제가 필요하다',
      }),
      expect.objectContaining({
        sequence: 2,
        speakerSide: DebateSide.SIDE_B,
        content: SILENT_TURN_PLACEHOLDER,
      }),
    ]);
  });

  it('논증 컴포넌트에 사실 검증 결과를 붙여 넘긴다', async () => {
    results.findComponents.mockResolvedValue([
      Object.assign(new DebateArgumentComponent(), {
        id: 'component-1',
        speakerSide: DebateSide.SIDE_A,
        kind: ArgumentComponentKind.EVIDENCE,
        statement: 'EU가 AI법을 시행했다',
      }),
      Object.assign(new DebateArgumentComponent(), {
        id: 'component-2',
        speakerSide: DebateSide.SIDE_B,
        kind: ArgumentComponentKind.CLAIM,
        statement: '규제는 혁신을 막는다',
      }),
    ]);
    results.findFactChecks.mockResolvedValue([
      Object.assign(new DebateFactCheckResult(), {
        componentId: 'component-1',
        status: VerificationStatus.SUPPORTED,
        reason: '공식 문서로 확인됨',
      }),
    ]);

    await service.handle(task);

    const [request] = judge.judge.mock.calls[0] as [DebateJudgeRequest];
    expect(request.components).toEqual([
      expect.objectContaining({
        statement: 'EU가 AI법을 시행했다',
        factCheck: {
          status: VerificationStatus.SUPPORTED,
          reason: '공식 문서로 확인됨',
        },
      }),
      // 검증되지 않은 컴포넌트는 null로 남겨 중립으로 보게 한다.
      expect.objectContaining({
        statement: '규제는 혁신을 막는다',
        factCheck: null,
      }),
    ]);
  });

  it('논증 관계를 별칭으로 이어 판정 입력에 넣는다', async () => {
    results.findComponents.mockResolvedValue([
      Object.assign(new DebateArgumentComponent(), {
        id: 'component-1',
        speakerSide: DebateSide.SIDE_A,
        kind: ArgumentComponentKind.CLAIM,
        statement: 'AI 규제가 필요하다',
      }),
      Object.assign(new DebateArgumentComponent(), {
        id: 'component-2',
        speakerSide: DebateSide.SIDE_B,
        kind: ArgumentComponentKind.REBUTTAL,
        statement: 'EU 사례는 과장됐다',
      }),
    ]);
    results.findRelations.mockResolvedValue([
      Object.assign(new DebateArgumentRelation(), {
        id: 'relation-1',
        fromComponentId: 'component-2',
        toComponentId: 'component-1',
        kind: ArgumentRelationKind.ATTACK,
      }),
    ]);

    await service.handle(task);

    const [request] = judge.judge.mock.calls[0] as [DebateJudgeRequest];
    // 별칭은 발언 순서를 따른다.
    expect(request.components.map((component) => component.ref)).toEqual([
      '#1',
      '#2',
    ]);
    expect(request.relations).toEqual([
      { fromRef: '#2', toRef: '#1', kind: ArgumentRelationKind.ATTACK },
    ]);
  });

  it('마디가 사라진 관계는 판정 입력에서 뺀다', async () => {
    results.findComponents.mockResolvedValue([
      Object.assign(new DebateArgumentComponent(), {
        id: 'component-1',
        speakerSide: DebateSide.SIDE_A,
        kind: ArgumentComponentKind.CLAIM,
        statement: 'AI 규제가 필요하다',
      }),
    ]);
    results.findRelations.mockResolvedValue([
      Object.assign(new DebateArgumentRelation(), {
        fromComponentId: 'component-1',
        // 재분석으로 교체되어 이제는 없는 마디.
        toComponentId: 'component-9',
        kind: ArgumentRelationKind.ATTACK,
      }),
    ]);

    await service.handle(task);

    const [request] = judge.judge.mock.calls[0] as [DebateJudgeRequest];
    expect(request.relations).toEqual([]);
  });

  it('점수 검증에 걸리면 저장하지 않고 예외를 올린다(재시도 대상)', async () => {
    judge.judge.mockResolvedValue(
      judgment({
        sideA: {
          argumentationScore: 120,
          interactionScore: 60,
          factualReliabilityScore: 70,
          feedback: 'A 피드백',
          violations: [],
        },
      }),
    );

    await expect(service.handle(task)).rejects.toThrow(
      JudgmentScoreValidationError,
    );
    expect(results.completeJudgment).not.toHaveBeenCalled();
  });

  it('상대가 없는 토론은 재시도 불가로 끝낸다', async () => {
    debates.findOneOrThrow.mockResolvedValue(
      buildDebate({ opponentId: null, opponentNickname: null }),
    );

    await expect(service.handle(task)).rejects.toThrow(NonRetryableTaskError);
  });

  describe('총점·승자 계산', () => {
    it('가중합으로 총점을 계산한다', () => {
      // 80*0.4 + 70*0.3 + 60*0.3 = 71
      expect(
        calculateTotalScore({
          argumentationScore: 80,
          interactionScore: 70,
          factualReliabilityScore: 60,
        }),
      ).toBe(71);
    });

    it('가중치 합이 1이라 만점은 총점도 만점이다', () => {
      const weightSum =
        SCORE_WEIGHTS.argumentation +
        SCORE_WEIGHTS.interaction +
        SCORE_WEIGHTS.factualReliability;

      expect(weightSum).toBeCloseTo(1);
      expect(
        calculateTotalScore({
          argumentationScore: 100,
          interactionScore: 100,
          factualReliabilityScore: 100,
        }),
      ).toBe(100);
    });

    it('소수점은 반올림한다', () => {
      // 71*0.4 + 71*0.3 + 72*0.3 = 71.3 → 71
      expect(
        calculateTotalScore({
          argumentationScore: 71,
          interactionScore: 71,
          factualReliabilityScore: 72,
        }),
      ).toBe(71);
    });

    it.each([
      [71, 73, JudgmentWinner.SIDE_B],
      [73, 71, JudgmentWinner.SIDE_A],
      [73, 73, JudgmentWinner.DRAW],
      // 1점 차도 승패를 가른다(완전 동점만 무승부).
      [73, 72, JudgmentWinner.SIDE_A],
    ])('총점 %i vs %i면 %s', (sideA, sideB, expected) => {
      expect(decideWinner(sideA, sideB)).toBe(expected);
    });
  });

  describe('Score Validator', () => {
    const rejects = async (overrides: Partial<DebateJudgeResult>) => {
      judge.judge.mockResolvedValue(judgment(overrides));

      await expect(service.handle(task)).rejects.toThrow(
        JudgmentScoreValidationError,
      );
      expect(results.completeJudgment).not.toHaveBeenCalled();
    };

    const side = (overrides: Partial<DebateJudgeResult['sideA']> = {}) => ({
      argumentationScore: 70,
      interactionScore: 60,
      factualReliabilityScore: 70,
      feedback: '피드백',
      violations: [],
      ...overrides,
    });

    it.each([
      ['0점 미만이면', { sideA: side({ interactionScore: -1 }) }],
      ['100점을 넘으면', { sideB: side({ argumentationScore: 101 }) }],
      ['정수가 아니면', { sideA: side({ factualReliabilityScore: 70.5 }) }],
      ['피드백이 비어 있으면', { sideB: side({ feedback: '  ' }) }],
      ['총평이 비어 있으면', { overallReason: '' }],
    ])(
      '%s 저장하지 않고 예외를 올린다(재시도 대상)',
      async (_name, overrides) => {
        await rejects(overrides);
      },
    );

    it.each([0, 100])('경계값 %i점은 통과한다', async (score) => {
      judge.judge.mockResolvedValue(
        judgment({
          sideA: side({
            argumentationScore: score,
            interactionScore: score,
            factualReliabilityScore: score,
          }),
        }),
      );

      await service.handle(task);

      expect(results.completeJudgment).toHaveBeenCalled();
    });
  });

  describe('위반에 따른 신뢰도 차감', () => {
    const violation = (
      severity: ViolationSeverity,
      type: ViolationType = 'disrespect',
    ): DebateViolation => ({ type, severity, evidence: '문제가 된 발언' });

    it('위반 정도별 차감량을 건별로 합산한다', () => {
      expect(toSocialCreditPenalty([])).toBe(0);
      expect(
        toSocialCreditPenalty([violation('minor'), violation('severe')]),
      ).toBe(SOCIAL_CREDIT_PENALTY.minor + SOCIAL_CREDIT_PENALTY.severe);
    });

    it('편마다 자기 위반만큼 신뢰도를 깎는다', async () => {
      judge.judge.mockResolvedValue(
        judgment({
          sideA: {
            argumentationScore: 70,
            interactionScore: 60,
            factualReliabilityScore: 70,
            feedback: 'A 피드백',
            violations: [violation('moderate'), violation('minor')],
          },
          sideB: {
            argumentationScore: 70,
            interactionScore: 80,
            factualReliabilityScore: 70,
            feedback: 'B 피드백',
            violations: [],
          },
        }),
      );

      await service.handle(task);

      // moderate(3) + minor(1) = 4
      expect(members.deductSocialCredit).toHaveBeenCalledWith(
        HOST_ID,
        4,
        MANAGER,
      );
      expect(members.deductSocialCredit).toHaveBeenCalledWith(
        OPPONENT_ID,
        0,
        MANAGER,
      );
    });

    it('차감은 판정 저장과 같은 트랜잭션에서 일어난다', async () => {
      judge.judge.mockResolvedValue(
        judgment({
          sideA: {
            argumentationScore: 70,
            interactionScore: 60,
            factualReliabilityScore: 70,
            feedback: 'A 피드백',
            violations: [violation('high')],
          },
        }),
      );
      // 저장소가 콜백을 부르지 않으면(=트랜잭션 밖) 차감도 일어나지 않아야 한다.
      results.completeJudgment.mockResolvedValue(undefined);

      await service.handle(task);

      expect(members.deductSocialCredit).not.toHaveBeenCalled();
    });

    it('위반 내역과 차감량을 감사 기록으로 남긴다', async () => {
      const violations = [violation('severe', 'threat')];
      judge.judge.mockResolvedValue(
        judgment({
          sideA: {
            argumentationScore: 70,
            interactionScore: 60,
            factualReliabilityScore: 70,
            feedback: 'A 피드백',
            violations,
          },
        }),
      );

      await service.handle(task);

      expect(results.completeJudgment).toHaveBeenCalledWith(
        expect.objectContaining({
          sideAViolations: violations,
          sideASocialCreditPenalty: SOCIAL_CREDIT_PENALTY.severe,
          sideBViolations: [],
          sideBSocialCreditPenalty: 0,
        }),
        expect.any(Function),
      );
    });

    it('위반이 총점을 깎지는 않는다', async () => {
      judge.judge.mockResolvedValue(
        judgment({
          sideA: {
            argumentationScore: 70,
            interactionScore: 60,
            factualReliabilityScore: 70,
            feedback: 'A 피드백',
            violations: [violation('severe')],
          },
        }),
      );

      await service.handle(task);

      // 70*0.4 + 60*0.3 + 70*0.3 = 67 — 위반과 무관하다.
      expect(results.completeJudgment).toHaveBeenCalledWith(
        expect.objectContaining({ sideATotalScore: 67 }),
        expect.any(Function),
      );
    });
  });
});
