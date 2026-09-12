import { Job, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import { DebateChatPublisher } from '../debate-chat/debate-chat.publisher';
import {
  DebateProcessingStage,
  DebateProcessingStageStatus,
} from '../debate-chat/debate-chat.types';
import { JudgeConfig } from './judge.config';
import { JudgeTaskRepository } from './judge-task.repository';
import {
  JudgeTaskQueue,
  JudgeTaskWorker,
  NonRetryableTaskError,
} from './judge-task.worker';
import { JudgeTaskKind, JudgeTaskStatus } from './judge.types';
import { JudgeTask } from './entities/judge-task.entity';

describe('JudgeTaskWorker', () => {
  const DEBATE_ID = 'debate-uuid';
  const TASK_ID = 'task-uuid';

  let handler: {
    kind: JudgeTaskKind;
    describe: jest.Mock;
    handle: jest.Mock;
  };
  let listener: { onTaskSettled: jest.Mock };
  let tasks: {
    findById: jest.Mock;
    acquire: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    release: jest.Mock;
  };
  let publisher: { processingStage: jest.Mock };
  let worker: JudgeTaskWorker;

  const buildTask = (overrides: Partial<JudgeTask> = {}): JudgeTask =>
    Object.assign(new JudgeTask(), {
      id: TASK_ID,
      debateId: DEBATE_ID,
      kind: JudgeTaskKind.ANALYZER,
      targetId: 'turn-uuid',
      status: JudgeTaskStatus.PENDING,
      attempt: 0,
      maxAttempts: 3,
      requestId: null,
      ...overrides,
    });

  const job = { data: { taskId: TASK_ID } } as Job<{ taskId: string }>;

  // worker가 이번 시도에 붙인 식별자. 결과 반영이 같은 값으로 일어나는지 보는 데 쓴다.
  const acquiredRequestId = (): string =>
    (tasks.acquire.mock.calls[0] as [string, string])[1];

  // 발행된 stage 이벤트를 [status, attempt, message] 로 납작하게 만든다.
  const stages = () =>
    publisher.processingStage.mock.calls.map(
      ([payload]: [{ status: string; attempt: number; message: string }]) => [
        payload.status,
        payload.attempt,
        payload.message,
      ],
    );

  beforeEach(() => {
    handler = {
      kind: JudgeTaskKind.ANALYZER,
      describe: jest.fn().mockResolvedValue('turn #2'),
      handle: jest.fn().mockResolvedValue(undefined),
    };
    listener = { onTaskSettled: jest.fn().mockResolvedValue(undefined) };
    tasks = {
      findById: jest.fn().mockResolvedValue(buildTask()),
      acquire: jest.fn().mockResolvedValue(
        buildTask({
          status: JudgeTaskStatus.PROCESSING,
          attempt: 1,
          requestId: 'request-uuid',
        }),
      ),
      complete: jest.fn().mockResolvedValue(true),
      fail: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(true),
    };
    publisher = { processingStage: jest.fn() };

    worker = new JudgeTaskWorker(
      {} as Redis,
      [handler],
      listener,
      tasks as unknown as JudgeTaskRepository,
      { enqueue: jest.fn() } as unknown as JudgeTaskQueue,
      publisher as unknown as DebateChatPublisher,
      {
        jobTimeoutMs: 1000,
        workerConcurrency: 1,
      } as unknown as JudgeConfig,
    );
  });

  it('작업을 선점해 실행하고 STARTED → COMPLETED를 발행한다', async () => {
    await worker.process(job);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(tasks.complete).toHaveBeenCalledWith(TASK_ID, acquiredRequestId());
    expect(stages()).toEqual([
      [DebateProcessingStageStatus.STARTED, 1, 'turn #2 ANALYZER 시작'],
      [DebateProcessingStageStatus.COMPLETED, 1, 'turn #2 ANALYZER 완료'],
    ]);
    expect(listener.onTaskSettled).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID }),
      'COMPLETED',
    );
  });

  it('stage 이벤트의 stage는 작업 종류를 따른다', async () => {
    await worker.process(job);

    const [payload] = publisher.processingStage.mock.calls[0] as [
      { stage: string; debateId: string },
    ];
    expect(payload).toMatchObject({
      stage: DebateProcessingStage.ANALYZER,
      debateId: DEBATE_ID,
    });
  });

  it('다른 worker가 선점했으면 아무 일도 하지 않는다', async () => {
    tasks.acquire.mockResolvedValue(null);

    await worker.process(job);

    expect(handler.handle).not.toHaveBeenCalled();
    expect(publisher.processingStage).not.toHaveBeenCalled();
  });

  it('이미 완료된 작업의 재실행은 결과를 건드리지 않는다(멱등)', async () => {
    tasks.findById.mockResolvedValue(
      buildTask({ status: JudgeTaskStatus.COMPLETED }),
    );

    await worker.process(job);

    expect(tasks.acquire).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('재시도 예산이 남은 실패는 PENDING으로 되돌리고 RETRYING을 발행한다', async () => {
    handler.handle.mockRejectedValue(new Error('rate limit'));

    await expect(worker.process(job)).rejects.toThrow('rate limit');

    expect(tasks.release).toHaveBeenCalledWith(
      TASK_ID,
      acquiredRequestId(),
      'rate limit',
    );
    expect(stages()[1]).toEqual([
      DebateProcessingStageStatus.RETRYING,
      1,
      'turn #2 ANALYZER 재시도 예정 (rate limit)',
    ]);
    // 아직 확정되지 않았으므로 후속 판단(판정 조건 평가)도 부르지 않는다.
    expect(listener.onTaskSettled).not.toHaveBeenCalled();
  });

  it('재시도를 소진하면 FAILED로 끝내고 다시 시도하지 않는다', async () => {
    tasks.acquire.mockResolvedValue(
      buildTask({
        status: JudgeTaskStatus.PROCESSING,
        attempt: 3,
        maxAttempts: 3,
        requestId: 'request-uuid',
      }),
    );
    handler.handle.mockRejectedValue(new Error('rate limit'));

    await expect(worker.process(job)).rejects.toThrow(UnrecoverableError);

    expect(tasks.fail).toHaveBeenCalledWith(
      TASK_ID,
      acquiredRequestId(),
      'rate limit',
    );
    expect(stages()[1][0]).toBe(DebateProcessingStageStatus.FAILED);
    // 최종 실패도 판정 조건 재평가 대상이다(검증 실패는 판정을 막지 않는다).
    expect(listener.onTaskSettled).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID }),
      'FAILED',
    );
  });

  it('재시도 불가 실패는 예산이 남아 있어도 즉시 FAILED다', async () => {
    handler.handle.mockRejectedValue(new NonRetryableTaskError('입력 없음'));

    await expect(worker.process(job)).rejects.toThrow(UnrecoverableError);

    expect(tasks.release).not.toHaveBeenCalled();
    expect(tasks.fail).toHaveBeenCalledWith(
      TASK_ID,
      acquiredRequestId(),
      '입력 없음',
    );
  });

  it('제한 시간을 넘기면 실패로 본다', async () => {
    // 끝나지 않는 작업. 타임아웃이 먼저 끊는지만 본다.
    handler.handle.mockImplementation(() => new Promise(() => {}));

    await expect(worker.process(job)).rejects.toThrow(/1000ms/);

    expect(tasks.release).toHaveBeenCalled();
  });

  it('작업 행이 사라졌으면 조용히 끝낸다', async () => {
    tasks.findById.mockResolvedValue(null);

    await worker.process(job);

    expect(tasks.acquire).not.toHaveBeenCalled();
  });
});
