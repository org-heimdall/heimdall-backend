import { Repository } from 'typeorm';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeTaskKind, JudgeTaskStatus } from './judge.types';
import { JudgeTask } from './entities/judge-task.entity';

describe('JudgeTaskRepository', () => {
  const DEBATE_ID = 'debate-uuid';
  const TURN_ID = 'turn-uuid';
  const TASK_ID = 'task-uuid';
  const REQUEST_ID = 'request-uuid';

  // 마지막으로 만들어진 UPDATE/INSERT 쿼리의 SET 값과 WHERE 절. 조건부 UPDATE의 조건을 검증한다.
  let lastSet: Record<string, unknown>;
  let conditions: string[];
  let execute: jest.Mock;
  let repository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    findBy: jest.Mock;
  };
  let taskRepository: JudgeTaskRepository;

  const buildTask = (overrides: Partial<JudgeTask> = {}): JudgeTask =>
    Object.assign(new JudgeTask(), {
      id: TASK_ID,
      debateId: DEBATE_ID,
      kind: JudgeTaskKind.ANALYZER,
      targetId: TURN_ID,
      status: JudgeTaskStatus.PENDING,
      attempt: 0,
      maxAttempts: 3,
      requestId: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

  beforeEach(() => {
    lastSet = {};
    conditions = [];
    execute = jest.fn();

    const builder: Record<string, unknown> = {};
    const chain = (name: string, capture?: (arg: unknown) => void) => {
      builder[name] = jest.fn((arg: unknown) => {
        capture?.(arg);
        return builder;
      });
    };
    chain('insert');
    chain('into');
    chain('values');
    chain('orIgnore');
    chain('update');
    chain('set', (arg) => {
      lastSet = arg as Record<string, unknown>;
    });
    chain('where', (arg) => conditions.push(String(arg)));
    chain('andWhere', (arg) => conditions.push(String(arg)));
    builder.execute = execute;

    repository = {
      createQueryBuilder: jest.fn(() => builder),
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    };
    taskRepository = new JudgeTaskRepository(
      repository as unknown as Repository<JudgeTask>,
    );
  });

  describe('createIfAbsent', () => {
    const create = () =>
      taskRepository.createIfAbsent({
        debateId: DEBATE_ID,
        kind: JudgeTaskKind.ANALYZER,
        targetId: TURN_ID,
        maxAttempts: 3,
      });

    it('새 작업이면 만들어진 행을 돌려준다', async () => {
      execute.mockResolvedValue({ identifiers: [{ id: TASK_ID }] });
      repository.findOneBy.mockResolvedValue(buildTask());

      await expect(create()).resolves.toMatchObject({
        id: TASK_ID,
        status: JudgeTaskStatus.PENDING,
      });
    });

    it('같은 (kind, target)이 이미 있으면 만들지 않고 기존 행을 돌려준다', async () => {
      // unique 충돌로 ON CONFLICT DO NOTHING → 삽입되지 않고 있던 행이 그대로 나온다.
      execute.mockResolvedValue({ identifiers: [] });
      const existing = buildTask({ attempt: 2 });
      repository.findOneBy.mockResolvedValue(existing);

      await expect(create()).resolves.toBe(existing);
    });
  });

  describe('acquire', () => {
    it('PENDING인 작업만 선점하고 attempt를 1 올린다', async () => {
      execute.mockResolvedValue({ affected: 1 });
      repository.findOneBy.mockResolvedValue(
        buildTask({
          status: JudgeTaskStatus.PROCESSING,
          attempt: 1,
          requestId: REQUEST_ID,
        }),
      );

      const task = await taskRepository.acquire(TASK_ID, REQUEST_ID);

      expect(task?.attempt).toBe(1);
      expect(task?.requestId).toBe(REQUEST_ID);
      expect(lastSet.status).toBe(JudgeTaskStatus.PROCESSING);
      expect(conditions).toEqual(
        expect.arrayContaining(['id = :taskId', 'status = :status']),
      );
    });

    it('다른 worker가 먼저 선점했으면 null이다(영향 행 0)', async () => {
      execute.mockResolvedValue({ affected: 0 });

      const task = await taskRepository.acquire(TASK_ID, REQUEST_ID);

      expect(task).toBeNull();
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('상태 전이', () => {
    it.each([
      [
        'complete',
        () => taskRepository.complete(TASK_ID, REQUEST_ID),
        JudgeTaskStatus.COMPLETED,
      ],
      [
        'fail',
        () => taskRepository.fail(TASK_ID, REQUEST_ID, '실패'),
        JudgeTaskStatus.FAILED,
      ],
      [
        'release',
        () => taskRepository.release(TASK_ID, REQUEST_ID, '재시도'),
        JudgeTaskStatus.PENDING,
      ],
    ])(
      '%s는 선점 중(PROCESSING)이고 request_id가 같을 때만 반영된다',
      async (_name, call, expectedStatus) => {
        execute.mockResolvedValue({ affected: 1 });

        await expect(call()).resolves.toBe(true);

        expect(lastSet.status).toBe(expectedStatus);
        expect(conditions).toEqual(
          expect.arrayContaining([
            'status = :status',
            'request_id = :requestId',
          ]),
        );
      },
    );

    it('다른 시도가 선점해 간 뒤 도착한 결과는 반영되지 않는다', async () => {
      // request_id가 달라 조건에 걸리는 행이 없다.
      execute.mockResolvedValue({ affected: 0 });

      await expect(
        taskRepository.complete(TASK_ID, 'stale-request-uuid'),
      ).resolves.toBe(false);
    });

    it('release는 선점자를 비워 다음 시도가 가져갈 수 있게 한다', async () => {
      execute.mockResolvedValue({ affected: 1 });

      await taskRepository.release(TASK_ID, REQUEST_ID, '429');

      expect(lastSet).toMatchObject({
        status: JudgeTaskStatus.PENDING,
        requestId: null,
        lastError: '429',
      });
    });
  });

  describe('resetFailed', () => {
    it('FAILED인 작업을 PENDING으로 되돌리고 시도 횟수를 초기화한다', async () => {
      const failed = buildTask({ status: JudgeTaskStatus.FAILED });
      repository.findBy
        .mockResolvedValueOnce([failed])
        .mockResolvedValueOnce([
          buildTask({ status: JudgeTaskStatus.PENDING }),
        ]);
      execute.mockResolvedValue({ affected: 1 });

      const reset = await taskRepository.resetFailed(DEBATE_ID, [
        JudgeTaskKind.ANALYZER,
        JudgeTaskKind.JUDGE,
      ]);

      expect(reset).toHaveLength(1);
      expect(lastSet).toMatchObject({
        status: JudgeTaskStatus.PENDING,
        attempt: 0,
        requestId: null,
      });
    });

    it('되돌릴 작업이 없으면 UPDATE를 하지 않는다', async () => {
      repository.findBy.mockResolvedValue([]);

      await expect(
        taskRepository.resetFailed(DEBATE_ID, [JudgeTaskKind.JUDGE]),
      ).resolves.toEqual([]);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('countByKind', () => {
    it('종류별로 상태 개수를 집계한다', async () => {
      repository.findBy.mockResolvedValue([
        buildTask({ status: JudgeTaskStatus.COMPLETED }),
        buildTask({ status: JudgeTaskStatus.PENDING }),
        buildTask({
          kind: JudgeTaskKind.FACT_CHECK,
          status: JudgeTaskStatus.FAILED,
        }),
      ]);

      const counts = await taskRepository.countByKind(DEBATE_ID);

      expect(counts[JudgeTaskKind.ANALYZER]).toMatchObject({
        total: 2,
        completed: 1,
        pending: 1,
      });
      expect(counts[JudgeTaskKind.FACT_CHECK]).toMatchObject({
        total: 1,
        failed: 1,
      });
      expect(counts[JudgeTaskKind.JUDGE].total).toBe(0);
    });
  });
});
