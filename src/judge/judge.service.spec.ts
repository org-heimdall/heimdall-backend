import { Repository } from 'typeorm';
import { DebatePhase, DebateSide } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { JudgeConfig } from './judge.config';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeService } from './judge.service';
import { JudgeTaskQueue } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  ArgumentComponentKind,
  JudgeTaskKind,
  JudgeTaskStatus,
  JudgmentWinner,
  VerificationStatus,
} from './judge.types';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { DebateFactCheckResult } from './entities/debate-fact-check.entity';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { JudgeErrorCode } from './exceptions/judge-error-code';

describe('JudgeService', () => {
  const DEBATE_ID = 'debate-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const COOLDOWN_SECONDS = 300;

  let messages: { find: jest.Mock };
  let tasks: {
    findByTarget: jest.Mock;
    findFailed: jest.Mock;
    resetFailed: jest.Mock;
    countByKind: jest.Mock;
  };
  let queue: { schedule: jest.Mock; enqueue: jest.Mock };
  let results: {
    findJudgment: jest.Mock;
    restoreFinalized: jest.Mock;
    startJudging: jest.Mock;
    markFailed: jest.Mock;
    findComponents: jest.Mock;
    findFactChecks: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock; findOneDto: jest.Mock };
  let service: JudgeService;

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      topic: 'AI 규제, 필요한가?',
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      rebuttalQuestionRounds: 0,
      debateStatus: DebateStatus.DEBATE_FINALIZED,
      ...overrides,
    });

  const buildMessage = (sequence: number, body: string | null): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: `turn-${sequence}`,
      debateId: DEBATE_ID,
      memberId: HOST_ID,
      body,
      sequence,
      createdAt: new Date(),
    });

  const buildTask = (overrides: Partial<JudgeTask> = {}): JudgeTask =>
    Object.assign(new JudgeTask(), {
      id: 'task-uuid',
      debateId: DEBATE_ID,
      kind: JudgeTaskKind.ANALYZER,
      targetId: 'turn-1',
      status: JudgeTaskStatus.FAILED,
      attempt: 3,
      maxAttempts: 3,
      updatedAt: new Date(Date.now() - (COOLDOWN_SECONDS + 60) * 1000),
      ...overrides,
    });

  // 종류별 상태 개수. 지정하지 않은 것은 0이다.
  const counts = (overrides: {
    analyzer?: Record<string, number>;
    factCheck?: Record<string, number>;
  }) => ({
    [JudgeTaskKind.ANALYZER]: {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      ...overrides.analyzer,
    },
    [JudgeTaskKind.FACT_CHECK]: {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      ...overrides.factCheck,
    },
    [JudgeTaskKind.JUDGE]: {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    },
  });

  const setDebateStatus = (debateStatus: DebateStatus) => {
    debates.findOneOrThrow.mockResolvedValue(buildDebate({ debateStatus }));
  };

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toMatchObject({
      appError: expect.objectContaining({ code }) as object,
    });
  };

  beforeEach(() => {
    messages = {
      find: jest
        .fn()
        .mockResolvedValue([
          buildMessage(1, '규제가 필요하다'),
          buildMessage(2, ''),
        ]),
    };
    tasks = {
      findByTarget: jest.fn().mockResolvedValue(null),
      findFailed: jest.fn().mockResolvedValue([]),
      resetFailed: jest.fn().mockResolvedValue([]),
      // 기본값은 "분석이 아직 남아 있다"(판정 시작 전).
      countByKind: jest
        .fn()
        .mockResolvedValue(counts({ analyzer: { total: 2, pending: 2 } })),
    };
    queue = {
      schedule: jest.fn().mockResolvedValue(undefined),
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    results = {
      findJudgment: jest.fn().mockResolvedValue(null),
      restoreFinalized: jest.fn().mockResolvedValue(true),
      startJudging: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
      findComponents: jest.fn().mockResolvedValue([]),
      findFactChecks: jest.fn().mockResolvedValue([]),
    };
    debates = {
      findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()),
      findOneDto: jest.fn().mockResolvedValue({ id: DEBATE_ID }),
    };

    service = new JudgeService(
      messages as unknown as Repository<DebateMessage>,
      tasks as unknown as JudgeTaskRepository,
      queue as unknown as JudgeTaskQueue,
      results as unknown as JudgeResultRepository,
      debates as unknown as DebatesService,
      {
        judgeRetryCooldownSeconds: COOLDOWN_SECONDS,
      } as unknown as JudgeConfig,
    );
  });

  describe('requestJudgment', () => {
    it('분석 작업이 없는 확정 턴을 채우고 판정 조건을 다시 본다', async () => {
      await expectCode(
        service.requestJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.IN_PROGRESS.code,
      );

      // 빈 턴(2번)은 건너뛴다.
      expect(queue.schedule).toHaveBeenCalledTimes(1);
      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.ANALYZER,
        'turn-1',
      );
      expect(tasks.countByKind).toHaveBeenCalledWith(DEBATE_ID);
    });

    it('이미 작업이 있는 턴은 다시 만들지 않는다', async () => {
      tasks.findByTarget.mockResolvedValue(
        buildTask({ status: JudgeTaskStatus.COMPLETED }),
      );

      await expectCode(
        service.requestJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.IN_PROGRESS.code,
      );

      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('판정이 끝났으면 저장된 결과를 돌려준다', async () => {
      results.findJudgment.mockResolvedValue(
        Object.assign(new DebateJudgmentResult(), {
          id: 'judgment-uuid',
          debateId: DEBATE_ID,
          winner: JudgmentWinner.SIDE_A,
          sideATotalScore: 73,
          sideBTotalScore: 71,
          judgedAt: new Date('2026-09-07T12:20:00.000Z'),
        }),
      );

      const result = await service.requestJudgment(DEBATE_ID, HOST_ID);

      expect(result).toMatchObject({
        id: 'judgment-uuid',
        winner: JudgmentWinner.SIDE_A,
        judgedAt: '2026-09-07T12:20:00.000Z',
      });
      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('아직 끝나지 않은 토론이면 거절한다', async () => {
      setDebateStatus(DebateStatus.IN_PROGRESS);

      await expectCode(
        service.requestJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.NOT_FINALIZED.code,
      );
    });

    it('분석이 최종 실패했으면 재시도하라고 답한다', async () => {
      tasks.countByKind.mockResolvedValue(
        counts({ analyzer: { total: 2, completed: 1, failed: 1 } }),
      );

      await expectCode(
        service.requestJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.PROCESSING_FAILED.code,
      );
    });

    it('당사자가 아니면 거절한다', async () => {
      await expectCode(
        service.requestJudgment(DEBATE_ID, 'stranger-uuid'),
        'COMMON.FORBIDDEN',
      );
    });
  });

  describe('retryJudgment', () => {
    beforeEach(() => {
      // 재개할 것이 없는 상태(모든 턴에 작업이 있다)를 기본으로 둔다.
      tasks.findByTarget.mockResolvedValue(
        buildTask({ status: JudgeTaskStatus.COMPLETED }),
      );
    });

    it('실패한 작업을 PENDING으로 되돌려 다시 큐에 넣고 토론 상태를 복구한다', async () => {
      const failed = buildTask();
      tasks.findFailed.mockResolvedValue([failed]);
      tasks.resetFailed.mockResolvedValue([
        buildTask({ status: JudgeTaskStatus.PENDING, attempt: 0 }),
      ]);

      await expectCode(
        service.retryJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.IN_PROGRESS.code,
      );

      expect(tasks.resetFailed).toHaveBeenCalledWith(DEBATE_ID, [
        JudgeTaskKind.ANALYZER,
        JudgeTaskKind.JUDGE,
      ]);
      expect(queue.enqueue).toHaveBeenCalledTimes(1);
      expect(results.restoreFinalized).toHaveBeenCalledWith(DEBATE_ID);
    });

    it('마지막 실패로부터 쿨다운이 지나지 않았으면 거절한다', async () => {
      tasks.findFailed.mockResolvedValue([
        buildTask({ updatedAt: new Date(Date.now() - 10_000) }),
      ]);

      await expectCode(
        service.retryJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.RETRY_NOT_READY.code,
      );
      expect(tasks.resetFailed).not.toHaveBeenCalled();
    });

    it('되돌릴 작업도 채울 작업도 없으면 거절한다', async () => {
      await expectCode(
        service.retryJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.NOTHING_TO_RETRY.code,
      );
    });

    it('이미 판정이 끝났으면 거절한다', async () => {
      results.findJudgment.mockResolvedValue(new DebateJudgmentResult());

      await expectCode(
        service.retryJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.ALREADY_COMPLETED.code,
      );
    });
  });

  describe('getResult', () => {
    beforeEach(() => {
      results.findJudgment.mockResolvedValue(
        Object.assign(new DebateJudgmentResult(), {
          id: 'judgment-uuid',
          debateId: DEBATE_ID,
          winner: JudgmentWinner.DRAW,
          judgedAt: new Date('2026-09-07T12:20:00.000Z'),
        }),
      );
    });

    it('판정·검증 결과와 요청자의 편을 함께 돌려준다', async () => {
      results.findComponents.mockResolvedValue([
        Object.assign(new DebateArgumentComponent(), {
          id: 'component-1',
          speakerId: HOST_ID,
          speakerSide: DebateSide.SIDE_A,
          kind: ArgumentComponentKind.EVIDENCE,
          statement: 'EU가 AI법을 시행했다',
        }),
      ]);
      results.findFactChecks.mockResolvedValue([
        Object.assign(new DebateFactCheckResult(), {
          id: 'check-1',
          componentId: 'component-1',
          status: VerificationStatus.SUPPORTED,
          reason: '공식 문서로 확인됨',
          checkedAt: new Date('2026-09-07T12:15:00.000Z'),
          sources: [
            {
              title: 'EU AI Act',
              publisher: 'European Commission',
              url: 'https://example.org/ai-act',
            },
          ],
        }),
      ]);

      const result = await service.getResult(DEBATE_ID, OPPONENT_ID);

      expect(result.viewerSide).toBe(DebateSide.SIDE_B);
      expect(result.judgmentResult.winner).toBe(JudgmentWinner.DRAW);
      expect(result.factChecks).toEqual([
        expect.objectContaining({
          componentId: 'component-1',
          speakerSide: DebateSide.SIDE_A,
          statement: 'EU가 AI법을 시행했다',
          status: VerificationStatus.SUPPORTED,
          checkedAt: '2026-09-07T12:15:00.000Z',
        }),
      ]);
    });

    it('관전자의 편은 null이다', async () => {
      const result = await service.getResult(DEBATE_ID, 'viewer-uuid');

      expect(result.viewerSide).toBeNull();
    });

    it('아직 판정 전이면 거절한다', async () => {
      results.findJudgment.mockResolvedValue(null);

      await expectCode(
        service.getResult(DEBATE_ID, HOST_ID),
        JudgeErrorCode.RESULT_NOT_READY.code,
      );
    });
  });

  describe('tryStartJudge', () => {
    it('모든 분석이 끝나고 검증도 남지 않았으면 Judge 작업을 만들고 JUDGING으로 옮긴다', async () => {
      tasks.countByKind.mockResolvedValue(
        counts({
          analyzer: { total: 2, completed: 2 },
          factCheck: { total: 1, completed: 1 },
        }),
      );

      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe('STARTED');

      // 판정 작업의 대상은 토론 자체다.
      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.JUDGE,
        DEBATE_ID,
      );
      expect(results.startJudging).toHaveBeenCalledWith(DEBATE_ID);
    });

    it('검증이 최종 실패해도 판정을 막지 않는다', async () => {
      tasks.countByKind.mockResolvedValue(
        counts({
          analyzer: { total: 2, completed: 2 },
          factCheck: { total: 2, completed: 1, failed: 1 },
        }),
      );

      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe('STARTED');
    });

    it.each([
      [
        '분석이 아직 남아 있으면',
        counts({ analyzer: { total: 2, completed: 1, pending: 1 } }),
      ],
      [
        '검증이 아직 돌고 있으면',
        counts({
          analyzer: { total: 1, completed: 1 },
          factCheck: { total: 1, processing: 1 },
        }),
      ],
    ])('%s 판정을 시작하지 않는다', async (_name, taskCounts) => {
      tasks.countByKind.mockResolvedValue(taskCounts);

      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe(
        'IN_PROGRESS',
      );
      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('분석이 최종 실패하면 토론을 FAILED로 두고 판정하지 않는다', async () => {
      tasks.countByKind.mockResolvedValue(
        counts({ analyzer: { total: 2, completed: 1, failed: 1 } }),
      );

      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe(
        'ANALYZER_FAILED',
      );
      expect(results.markFailed).toHaveBeenCalledWith(DEBATE_ID);
      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it.each([
      [DebateStatus.IN_PROGRESS, 'NOT_FINALIZED'],
      [DebateStatus.READY, 'NOT_FINALIZED'],
      [DebateStatus.FAILED, 'NOT_FINALIZED'],
      [DebateStatus.COMPLETED, 'ALREADY_COMPLETED'],
    ])('토론이 %s면 %s', async (debateStatus, expected) => {
      setDebateStatus(debateStatus);

      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe(expected);
      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('이미 JUDGING이어도 다시 부를 수 있다(멱등)', async () => {
      setDebateStatus(DebateStatus.JUDGING);
      tasks.countByKind.mockResolvedValue(
        counts({ analyzer: { total: 1, completed: 1 } }),
      );

      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe('STARTED');
      await expect(service.tryStartJudge(DEBATE_ID)).resolves.toBe('STARTED');

      // 작업 행이 (kind, target) unique라 두 번 불러도 Judge 작업은 하나뿐이다.
      expect(queue.schedule).toHaveBeenCalledTimes(2);
    });
  });

  describe('onTaskSettled', () => {
    const settled = (kind: JudgeTaskKind) =>
      Object.assign(new JudgeTask(), {
        id: 'task-uuid',
        debateId: DEBATE_ID,
        kind,
        targetId: 'target-uuid',
        status: JudgeTaskStatus.COMPLETED,
      });

    it.each([JudgeTaskKind.ANALYZER, JudgeTaskKind.FACT_CHECK])(
      '%s 작업이 확정되면 판정 조건을 다시 본다',
      async (kind) => {
        await service.onTaskSettled(settled(kind));

        expect(tasks.countByKind).toHaveBeenCalledWith(DEBATE_ID);
      },
    );

    it('Judge 작업 자신의 결과로는 다시 평가하지 않는다', async () => {
      await service.onTaskSettled(settled(JudgeTaskKind.JUDGE));

      expect(debates.findOneOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('onTurnFinalized', () => {
    const turn = (content: string) => ({
      id: 'turn-1',
      debateId: DEBATE_ID,
      speakerId: HOST_ID,
      speakerSide: DebateSide.SIDE_A,
      phase: DebatePhase.OPENING,
      round: 1,
      content,
      createdAt: new Date().toISOString(),
      sequence: 1,
    });

    it('확정 턴마다 분석 작업을 만든다', async () => {
      await service.onTurnFinalized(turn('규제가 필요하다'));

      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.ANALYZER,
        'turn-1',
      );
    });

    it('빈 턴(시간 초과)은 작업을 만들지 않는다', async () => {
      await service.onTurnFinalized(turn('   '));

      expect(queue.schedule).not.toHaveBeenCalled();
    });
  });
});
