import { Repository } from 'typeorm';
import { DebateOutcomeService } from '../debate-outcomes/debate-outcome.service';
import { DebateOutcomeKind } from '../debate-outcomes/debate-outcome.types';
import { DebateEndReason } from '../debates/entities/debate-end-reason.enum';
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
import { JudgeTaskKind, JudgeTaskStatus, JudgmentWinner } from './judge.types';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import { DebateResultPresenter } from './debate-result.presenter';

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
    failJudgment: jest.Mock;
    findComponents: jest.Mock;
    findFactChecks: jest.Mock;
  };
  let debates: { findOneOrThrow: jest.Mock; findOneDto: jest.Mock };
  let outcomes: { applyWithin: jest.Mock; announce: jest.Mock };
  let presenter: { presentJudgment: jest.Mock; presentFactChecks: jest.Mock };
  let service: JudgeService;
  // failJudgment가 트랜잭션 안에서 넘겨주는 manager 자리.
  const MANAGER = { id: 'entity-manager' };

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: 'community-uuid',
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
      // 저장소가 전이에 성공하면 트랜잭션 안에서 부수 작업을 부르는 것까지 재현한다.
      failJudgment: jest
        .fn()
        .mockImplementation(
          async (
            _debateId: string,
            withinTransaction: (manager: unknown) => Promise<void>,
          ) => {
            await withinTransaction(MANAGER);
            return true;
          },
        ),
      findComponents: jest.fn().mockResolvedValue([]),
      findFactChecks: jest.fn().mockResolvedValue([]),
    };
    debates = {
      findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()),
      findOneDto: jest.fn().mockResolvedValue({ id: DEBATE_ID }),
    };

    outcomes = {
      applyWithin: jest.fn().mockResolvedValue(undefined),
      announce: jest.fn().mockResolvedValue(undefined),
    };

    // 화면용 가공은 presenter 스펙이 검증한다. 여기서는 저장된 판정을 그대로 옮긴다.
    presenter = {
      presentJudgment: jest.fn(
        (_debate: Debate, judgment: DebateJudgmentResult) => ({
          id: judgment.id,
          winner: judgment.winner,
          judgedAt: judgment.judgedAt.toISOString(),
        }),
      ),
      presentFactChecks: jest.fn().mockResolvedValue([]),
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
      outcomes as unknown as DebateOutcomeService,
      presenter as unknown as DebateResultPresenter,
    );
  });

  describe('startJudging', () => {
    it('판정 작업을 만들고 지금의 토론 상태를 돌려준다', async () => {
      tasks.countByKind.mockResolvedValue(
        counts({ analyzer: { total: 1, completed: 1 } }),
      );

      await expect(service.startJudging(DEBATE_ID, HOST_ID)).resolves.toEqual({
        id: DEBATE_ID,
      });

      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.JUDGE,
        DEBATE_ID,
      );
      expect(results.startJudging).toHaveBeenCalledWith(DEBATE_ID);
    });

    it('앞 단계가 아직 돌고 있어도 409가 아니라 상태를 돌려준다', async () => {
      await expect(service.startJudging(DEBATE_ID, HOST_ID)).resolves.toEqual({
        id: DEBATE_ID,
      });

      expect(queue.schedule).not.toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.JUDGE,
        DEBATE_ID,
      );
    });

    it('이미 판정이 끝난 토론에 다시 불러도 상태를 돌려준다(멱등)', async () => {
      setDebateStatus(DebateStatus.COMPLETED);

      await expect(service.startJudging(DEBATE_ID, HOST_ID)).resolves.toEqual({
        id: DEBATE_ID,
      });
    });

    it('아직 끝나지 않은 토론이면 거절한다', async () => {
      setDebateStatus(DebateStatus.IN_PROGRESS);

      await expectCode(
        service.startJudging(DEBATE_ID, HOST_ID),
        JudgeErrorCode.NOT_FINALIZED.code,
      );
    });

    it('당사자가 아니면 거절한다', async () => {
      await expectCode(
        service.startJudging(DEBATE_ID, 'stranger-uuid'),
        'COMMON.FORBIDDEN',
      );
    });
  });

  describe('requestJudgment', () => {
    it('분석 작업이 없는 닫힌 라운드를 채우고 판정 조건을 다시 본다', async () => {
      await expectCode(
        service.requestJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.IN_PROGRESS.code,
      );

      // OPENING 라운드(1, 2번)만 닫혀 있고, 작업 대상은 라운드를 닫는 2번 턴이다(빈 턴이어도 앵커가 된다).
      expect(queue.schedule).toHaveBeenCalledTimes(1);
      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.ANALYZER,
        'turn-2',
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

      expect(presenter.presentJudgment).toHaveBeenCalledWith(
        expect.objectContaining({ id: DEBATE_ID }),
        expect.objectContaining({ id: 'judgment-uuid' }),
      );
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
      // 되돌린 뒤에 작업을 올려야 판정이 조건부 전이에서 지지 않는다.
      expect(results.restoreFinalized.mock.invocationCallOrder[0]).toBeLessThan(
        queue.enqueue.mock.invocationCallOrder[0],
      );
    });

    it('판정 실패로 닫힌 토론은 재시도할 수 있다', async () => {
      // 처음 읽을 때는 판정 실패로 닫혀 있고, 되돌린 뒤 다시 읽으면 DEBATE_FINALIZED다.
      debates.findOneOrThrow.mockResolvedValueOnce(
        buildDebate({
          debateStatus: DebateStatus.FAILED,
          endReason: DebateEndReason.JUDGMENT_FAILED,
        }),
      );
      tasks.findFailed.mockResolvedValue([
        buildTask({ kind: JudgeTaskKind.JUDGE }),
      ]);
      tasks.resetFailed.mockResolvedValue([
        buildTask({
          kind: JudgeTaskKind.JUDGE,
          status: JudgeTaskStatus.PENDING,
        }),
      ]);

      await expectCode(
        service.retryJudgment(DEBATE_ID, HOST_ID),
        JudgeErrorCode.IN_PROGRESS.code,
      );
      expect(results.restoreFinalized).toHaveBeenCalledWith(DEBATE_ID);
      expect(queue.enqueue).toHaveBeenCalledTimes(1);
    });

    it.each([DebateEndReason.FORFEIT, DebateEndReason.TOTAL_TIME_EXPIRED])(
      '%s로 끝난 토론은 되살리지 않는다(판정·보상이 겹친다)',
      async (endReason) => {
        debates.findOneOrThrow.mockResolvedValue(
          buildDebate({ debateStatus: DebateStatus.FAILED, endReason }),
        );
        tasks.findFailed.mockResolvedValue([buildTask()]);

        await expectCode(
          service.retryJudgment(DEBATE_ID, HOST_ID),
          JudgeErrorCode.NOTHING_TO_RETRY.code,
        );
        expect(results.restoreFinalized).not.toHaveBeenCalled();
        expect(tasks.resetFailed).not.toHaveBeenCalled();
        expect(queue.schedule).not.toHaveBeenCalled();
      },
    );

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
      const cards = [{ id: 'check-1', componentId: 'component-1' }];
      presenter.presentFactChecks.mockResolvedValue(cards);

      const result = await service.getResult(DEBATE_ID, OPPONENT_ID);

      expect(result.viewerSide).toBe(DebateSide.SIDE_B);
      expect(result.judgmentResult.winner).toBe(JudgmentWinner.DRAW);
      expect(presenter.presentFactChecks).toHaveBeenCalledWith(DEBATE_ID);
      expect(result.factChecks).toBe(cards);
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
      expect(results.failJudgment).toHaveBeenCalledWith(
        DEBATE_ID,
        expect.any(Function),
      );
      // 판정 실패로 닫으면서 같은 트랜잭션에서 커뮤니티를 복귀시킨다.
      expect(outcomes.applyWithin).toHaveBeenCalledWith(MANAGER, {
        debateId: DEBATE_ID,
        communityId: 'community-uuid',
        kind: DebateOutcomeKind.JUDGMENT_FAILED,
        status: DebateStatus.FAILED,
        reason: DebateEndReason.JUDGMENT_FAILED,
        winnerId: null,
      });
      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('이미 판정 실패로 닫혀 있으면 결과를 다시 반영하지 않는다', async () => {
      tasks.countByKind.mockResolvedValue(
        counts({ analyzer: { total: 2, completed: 1, failed: 1 } }),
      );
      results.failJudgment.mockResolvedValue(false);

      await service.tryStartJudge(DEBATE_ID);

      expect(outcomes.applyWithin).not.toHaveBeenCalled();
      expect(outcomes.announce).not.toHaveBeenCalled();
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
        await service.onTaskSettled(settled(kind), 'COMPLETED');

        expect(tasks.countByKind).toHaveBeenCalledWith(DEBATE_ID);
      },
    );

    it('Judge 작업 자신의 결과로는 다시 평가하지 않는다', async () => {
      await service.onTaskSettled(settled(JudgeTaskKind.JUDGE), 'COMPLETED');

      expect(debates.findOneOrThrow).not.toHaveBeenCalled();
      expect(results.failJudgment).not.toHaveBeenCalled();
    });

    it('Judge 작업이 최종 실패하면 토론을 판정 실패로 닫고 커뮤니티를 복귀시킨다', async () => {
      setDebateStatus(DebateStatus.JUDGING);

      await service.onTaskSettled(settled(JudgeTaskKind.JUDGE), 'FAILED');

      expect(results.failJudgment).toHaveBeenCalledWith(
        DEBATE_ID,
        expect.any(Function),
      );
      expect(outcomes.applyWithin).toHaveBeenCalledWith(
        MANAGER,
        expect.objectContaining({
          kind: DebateOutcomeKind.JUDGMENT_FAILED,
          reason: DebateEndReason.JUDGMENT_FAILED,
        }),
      );
      expect(outcomes.announce).toHaveBeenCalledTimes(1);
      // 판정 조건을 다시 보지 않는다.
      expect(tasks.countByKind).not.toHaveBeenCalled();
    });
  });

  describe('onTurnFinalized', () => {
    // 반론·질의 0라운드: OPENING(1, 2) → CLOSING(3, 4).
    const turn = (sequence: number, content: string) => ({
      id: `turn-${sequence}`,
      debateId: DEBATE_ID,
      speakerId: sequence % 2 === 1 ? HOST_ID : OPPONENT_ID,
      speakerSide: sequence % 2 === 1 ? DebateSide.SIDE_A : DebateSide.SIDE_B,
      phase: sequence <= 2 ? DebatePhase.OPENING : DebatePhase.CLOSING,
      round: 1,
      content,
      createdAt: new Date().toISOString(),
      sequence,
    });

    it('라운드 중간 턴이 확정되면 아직 작업을 만들지 않는다', async () => {
      await service.onTurnFinalized(turn(1, '규제가 필요하다'));

      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('라운드를 닫는 턴이 확정되면 그 턴을 대상으로 라운드 분석 작업 하나를 만든다', async () => {
      messages.find.mockResolvedValue([
        buildMessage(1, '규제가 필요하다'),
        buildMessage(2, ''),
      ]);

      await service.onTurnFinalized(turn(2, ''));

      expect(queue.schedule).toHaveBeenCalledTimes(1);
      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.ANALYZER,
        'turn-2',
      );
    });

    it('라운드 턴이 전부 비어 있으면(시간 초과) 작업을 만들지 않는다', async () => {
      messages.find.mockResolvedValue([
        buildMessage(3, '  '),
        buildMessage(4, null),
      ]);

      await service.onTurnFinalized(turn(4, ''));

      expect(queue.schedule).not.toHaveBeenCalled();
    });
  });

  describe('onDebateEnded', () => {
    const allTurns = () =>
      [1, 2, 3, 4].map((sequence) =>
        buildMessage(sequence, `발언 ${sequence}`),
      );

    it('판정 조건을 보기 전에 닫힌 라운드의 분석 작업을 먼저 보장한다(마지막 턴 훅과의 경합 방지)', async () => {
      messages.find.mockResolvedValue(allTurns());
      // 마지막 라운드 작업이 아직 없는 상태 — 마지막 턴 훅보다 이 훅이 먼저 돈 경우다.
      tasks.findByTarget.mockImplementation(
        (_kind: JudgeTaskKind, targetId: string) =>
          Promise.resolve(
            targetId === 'turn-2'
              ? buildTask({ status: JudgeTaskStatus.COMPLETED })
              : null,
          ),
      );
      tasks.countByKind.mockResolvedValue(
        counts({ analyzer: { total: 1, completed: 1 } }),
      );

      await service.onDebateEnded(DEBATE_ID);

      expect(queue.schedule).toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.ANALYZER,
        'turn-4',
      );
      expect(queue.schedule.mock.invocationCallOrder[0]).toBeLessThan(
        tasks.countByKind.mock.invocationCallOrder[0],
      );
    });

    it('라운드 작업이 모두 있으면 새로 만들지 않는다(멱등)', async () => {
      messages.find.mockResolvedValue(allTurns());
      tasks.findByTarget.mockResolvedValue(
        buildTask({ status: JudgeTaskStatus.COMPLETED }),
      );

      await service.onDebateEnded(DEBATE_ID);

      expect(queue.schedule).not.toHaveBeenCalledWith(
        DEBATE_ID,
        JudgeTaskKind.ANALYZER,
        expect.anything(),
      );
    });
  });

  it('마지막 FactCheck batch가 확정되면 같은 호출 안에서 바로 Judge 작업을 만든다(polling 없음)', async () => {
    tasks.countByKind.mockResolvedValue(
      counts({
        analyzer: { total: 2, completed: 2 },
        factCheck: { total: 2, completed: 2 },
      }),
    );

    await service.onTaskSettled(
      Object.assign(new JudgeTask(), {
        id: 'fact-check-task',
        debateId: DEBATE_ID,
        kind: JudgeTaskKind.FACT_CHECK,
        targetId: 'turn-4',
        status: JudgeTaskStatus.COMPLETED,
      }),
      'COMPLETED',
    );

    expect(queue.schedule).toHaveBeenCalledWith(
      DEBATE_ID,
      JudgeTaskKind.JUDGE,
      DEBATE_ID,
    );
    expect(results.startJudging).toHaveBeenCalledWith(DEBATE_ID);
  });
});
