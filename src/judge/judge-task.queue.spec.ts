import Redis from 'ioredis';
import { JudgeConfig } from './judge.config';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeTaskQueue } from './judge-task.worker';
import { JudgeTaskKind, JudgeTaskStatus } from './judge.types';
import { JudgeTask } from './entities/judge-task.entity';

const add = jest.fn();
jest.mock('bullmq', () => ({
  ...jest.requireActual<object>('bullmq'),
  Queue: jest.fn().mockImplementation(() => ({ add, close: jest.fn() })),
}));

describe('JudgeTaskQueue', () => {
  const DEBATE_ID = 'debate-uuid';
  const ANCHOR_ID = 'turn-4';

  let tasks: {
    createIfAbsent: jest.Mock;
    resetSettled: jest.Mock;
    findByTarget: jest.Mock;
  };
  let queue: JudgeTaskQueue;

  const buildTask = (status: JudgeTaskStatus): JudgeTask =>
    Object.assign(new JudgeTask(), {
      id: 'task-uuid',
      debateId: DEBATE_ID,
      kind: JudgeTaskKind.FACT_CHECK,
      targetId: ANCHOR_ID,
      status,
      attempt: status === JudgeTaskStatus.PENDING ? 0 : 1,
      maxAttempts: 3,
    });

  beforeEach(() => {
    add.mockReset();
    tasks = {
      createIfAbsent: jest.fn(),
      resetSettled: jest.fn().mockResolvedValue(true),
      findByTarget: jest
        .fn()
        .mockResolvedValue(buildTask(JudgeTaskStatus.PENDING)),
    };
    queue = new JudgeTaskQueue(
      {} as Redis,
      tasks as unknown as JudgeTaskRepository,
      {
        maxAttempts: { [JudgeTaskKind.FACT_CHECK]: 3 },
        backoffMs: 1000,
      } as unknown as JudgeConfig,
    );
  });

  describe('reschedule', () => {
    it('작업이 없으면 만들어 큐에 올린다', async () => {
      tasks.createIfAbsent.mockResolvedValue(
        buildTask(JudgeTaskStatus.PENDING),
      );

      await queue.reschedule(DEBATE_ID, JudgeTaskKind.FACT_CHECK, ANCHOR_ID);

      expect(tasks.resetSettled).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledTimes(1);
    });

    it.each([JudgeTaskStatus.COMPLETED, JudgeTaskStatus.FAILED])(
      '이미 %s인 작업은 PENDING으로 되돌려 다시 큐에 올린다',
      async (status) => {
        tasks.createIfAbsent.mockResolvedValue(buildTask(status));

        const task = await queue.reschedule(
          DEBATE_ID,
          JudgeTaskKind.FACT_CHECK,
          ANCHOR_ID,
        );

        expect(tasks.resetSettled).toHaveBeenCalledWith(
          JudgeTaskKind.FACT_CHECK,
          ANCHOR_ID,
        );
        expect(task.status).toBe(JudgeTaskStatus.PENDING);
        expect(add).toHaveBeenCalledWith(
          JudgeTaskKind.FACT_CHECK,
          { taskId: 'task-uuid' },
          expect.objectContaining({ jobId: 'task-uuid' }),
        );
      },
    );

    it('진행 중인 작업은 건드리지 않는다', async () => {
      tasks.createIfAbsent.mockResolvedValue(
        buildTask(JudgeTaskStatus.PROCESSING),
      );

      await queue.reschedule(DEBATE_ID, JudgeTaskKind.FACT_CHECK, ANCHOR_ID);

      expect(tasks.resetSettled).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });
  });
});
