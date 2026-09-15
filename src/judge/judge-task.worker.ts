import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { DebateChatPublisher } from '../debate-chat/debate-chat.publisher';
import {
  DebateProcessingStage,
  DebateProcessingStageStatus,
} from '../debate-chat/debate-chat.types';
import { JudgeConfig } from './judge.config';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeTaskKind, JudgeTaskStatus } from './judge.types';
import { JudgeTask } from './entities/judge-task.entity';

export const BULLMQ_CONNECTION = Symbol('BULLMQ_CONNECTION');
export const JUDGE_TASK_HANDLERS = Symbol('JUDGE_TASK_HANDLERS');
export const JUDGE_TASK_LISTENER = Symbol('JUDGE_TASK_LISTENER');

const QUEUE_NAME = 'debate-judge';
// 정상 실행이라면 이 배수만큼의 시간 안에 끝났어야 한다. 살아 있는 작업을 뺏지 않도록 여유를 둔다.
const STALE_TIMEOUT_FACTOR = 3;

export type TaskOutcome = 'COMPLETED' | 'FAILED';

/**
 * 작업 종류 하나를 실제로 수행하는 것. worker는 선점·상태 전이·stage 이벤트만 맡고
 * 무엇을 하는지는 전부 구현체에 있다 — 종류를 늘려도 worker는 그대로다.
 */
export interface JudgeTaskHandler {
  readonly kind: JudgeTaskKind;

  /**
   * stage 메시지 앞에 붙는 표시. 턴 단위 작업은 `turn #3`처럼 돌려주고,
   * 토론 단위(JUDGE)는 null이다. 프론트가 필요하면 이 접두사를 파싱한다.
   */
  describe(task: JudgeTask): Promise<string | null>;

  // 본 작업. 실패는 예외로 알린다(재시도 불가 실패는 NonRetryableTaskError).
  handle(task: JudgeTask): Promise<void>;
}

/**
 * 작업이 확정될 때마다(성공이든 최종 실패든) 불린다. 판정 조건 평가가 이 자리에 붙는다 —
 * worker가 판정 조건을 알 필요가 없도록 분리한 것이다.
 */
export interface JudgeTaskListener {
  onTaskSettled(task: JudgeTask, outcome: TaskOutcome): Promise<void>;
}

/**
 * 재시도해도 결과가 달라지지 않는 실패(입력이 이미 사라졌거나 키가 없는 경우).
 * worker는 이 예외를 받으면 backoff 없이 즉시 FAILED로 끝낸다.
 */
export class NonRetryableTaskError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NonRetryableTaskError';
  }
}

// 큐에 실리는 것은 작업 행을 가리키는 식별자뿐이다. 실제 입력은 worker가 DB에서 다시 읽는다
// (재시작·재시도 사이에 payload가 낡는 문제를 원천 차단한다).
interface DebateProcessingJobData {
  taskId: string;
}

/**
 * BullMQ 전용 Redis 연결. 채팅이 쓰는 RedisModule의 인스턴스와 공유하면 안 된다 —
 * worker는 blocking 명령을 걸어 두므로 같은 연결의 다른 명령이 막힌다.
 */
export function createBullMqConnection(config: ConfigService): Redis {
  return new Redis({
    host: config.getOrThrow<string>('REDIS_HOST'),
    port: config.getOrThrow<number>('REDIS_PORT'),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    maxRetriesPerRequest: null,
  });
}

/**
 * 작업 큐. 큐는 하나이고 종류는 작업 행이 갖는다 — 세 종류의 처리 흐름이 같고(선점 → 실행 →
 * 확정) 동시성 제한도 파이프라인 전체 기준이라 큐를 나눌 이유가 없다.
 *
 * jobId는 작업 행의 id다. 같은 작업이 두 번 등록되면 BullMQ가 뒤엣것을 무시하므로,
 * 작업 행 unique와 함께 "같은 작업은 한 번만 실행된다"의 두 번째 방벽이 된다.
 */
@Injectable()
export class JudgeTaskQueue implements OnApplicationShutdown {
  private readonly queue: Queue<DebateProcessingJobData>;

  constructor(
    @Inject(BULLMQ_CONNECTION) connection: Redis,
    private readonly tasks: JudgeTaskRepository,
    private readonly config: JudgeConfig,
  ) {
    this.queue = new Queue<DebateProcessingJobData>(QUEUE_NAME, { connection });
  }

  // 대상 하나에 대한 작업을 보장한다. 두 번 불러도 작업 행은 하나이고 job도 하나다.
  async schedule(
    debateId: string,
    kind: JudgeTaskKind,
    targetId: string,
  ): Promise<JudgeTask> {
    const task = await this.tasks.createIfAbsent({
      debateId,
      kind,
      targetId,
      maxAttempts: this.config.maxAttempts[kind],
    });

    if (task.status === JudgeTaskStatus.PENDING) {
      await this.enqueue(task);
    }
    return task;
  }

  /**
   * 작업을 큐에 넣는다. 완료·최종 실패한 job은 지워 jobId를 비워 둔다 —
   * 재시도(/judge/retry)로 같은 작업을 다시 등록할 수 있어야 하기 때문이다.
   */
  async enqueue(task: JudgeTask): Promise<void> {
    await this.queue.add(
      task.kind,
      { taskId: task.id },
      {
        jobId: task.id,
        attempts: task.maxAttempts,
        backoff: { type: 'exponential', delay: this.config.backoffMs },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * 작업 실행기. 하는 일은 네 가지뿐이고 종류별 로직은 전부 handler에 있다.
 *
 * 1. 작업을 선점한다(PENDING → PROCESSING, 조건부 UPDATE). 실패하면 다른 worker가 가져간 것이므로 그냥 끝낸다.
 * 2. handler를 부르고 타임아웃을 건다.
 * 3. 결과를 확정한다(COMPLETED / 재시도 가능하면 PENDING 복귀 / 소진·재시도 불가면 FAILED).
 * 4. 전이마다 stage 이벤트를 내보내고, 확정된 작업을 listener(판정 조건 평가)에게 알린다.
 *
 * 부팅 시에는 재시작 전에 중단된 작업을 되살린다.
 */
@Injectable()
export class JudgeTaskWorker
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JudgeTaskWorker.name);
  private readonly handlers: Map<JudgeTaskKind, JudgeTaskHandler>;
  private worker: Worker<DebateProcessingJobData> | null = null;

  constructor(
    @Inject(BULLMQ_CONNECTION) private readonly connection: Redis,
    @Inject(JUDGE_TASK_HANDLERS)
    handlers: JudgeTaskHandler[],
    @Inject(JUDGE_TASK_LISTENER)
    private readonly listener: JudgeTaskListener,
    private readonly tasks: JudgeTaskRepository,
    private readonly queue: JudgeTaskQueue,
    private readonly publisher: DebateChatPublisher,
    private readonly config: JudgeConfig,
  ) {
    this.handlers = new Map(handlers.map((handler) => [handler.kind, handler]));
  }

  onModuleInit(): void {
    this.worker = new Worker<DebateProcessingJobData>(
      QUEUE_NAME,
      (job) => this.process(job),
      {
        connection: this.connection,
        concurrency: this.config.workerConcurrency,
      },
    );
    this.worker.on('error', (error) => {
      this.logger.error('작업 큐 worker 오류', error);
    });
  }

  /**
   * 부팅 복구. job 자체는 Redis에 남아 BullMQ가 다시 부르지만, 프로세스가 죽는 순간 선점되어
   * 있던 작업 행은 PROCESSING으로 남아 아무도 선점할 수 없다. 그런 행을 되돌린 뒤
   * PENDING인 작업을 모두 큐에 다시 넣는다(jobId가 같아 이미 있는 job은 무시된다).
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const staleBefore = new Date(
        Date.now() - this.config.jobTimeoutMs * STALE_TIMEOUT_FACTOR,
      );
      const reclaimed = await this.tasks.reclaimStale(staleBefore);
      if (reclaimed.length > 0) {
        this.logger.warn(
          `중단된 작업 ${reclaimed.length}건을 PENDING으로 되돌렸습니다.`,
        );
      }

      const pending = await this.tasks.findPending();
      for (const task of pending) {
        await this.queue.enqueue(task);
      }
      if (pending.length > 0) {
        this.logger.log(
          `처리 대기 작업 ${pending.length}건을 큐에 등록했습니다.`,
        );
      }
    } catch (error: unknown) {
      // 복구 실패로 부팅을 막지는 않는다. 다음 재시작이나 POST /judge 재개로도 풀린다.
      this.logger.error('토론 처리 작업 복구 실패', error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  /**
   * job 하나의 처리. 예외를 던지면 BullMQ가 backoff 뒤 다시 부르고,
   * UnrecoverableError를 던지면 재시도 없이 끝난다.
   */
  async process(job: Job<DebateProcessingJobData>): Promise<void> {
    const { taskId } = job.data;
    const task = await this.tasks.findById(taskId);
    if (task === null) {
      this.logger.warn(`작업 행이 없어 건너뜁니다: taskId=${taskId}`);
      return;
    }

    // 이미 끝난 작업의 재실행은 아무것도 하지 않는다(멱등, 내부 설계 "AI worker 상태").
    if (task.status === JudgeTaskStatus.COMPLETED) {
      return;
    }

    const requestId = randomUUID();
    const acquired = await this.tasks.acquire(taskId, requestId);
    if (acquired === null) {
      return;
    }

    const handler = this.handlers.get(acquired.kind);
    if (handler === undefined) {
      // 구현체가 등록되지 않은 종류다. 재시도해도 달라지지 않는다.
      const reason = `처리기가 없습니다: ${acquired.kind}`;
      await this.settleFailed(acquired, null, requestId, reason);
      throw new UnrecoverableError(reason);
    }

    const prefix = await this.describe(handler, acquired);
    this.publish(acquired, DebateProcessingStageStatus.STARTED, prefix, '시작');

    try {
      await this.runWithTimeout(handler, acquired);
    } catch (error: unknown) {
      await this.settleFailure(acquired, prefix, requestId, error);
      return;
    }

    await this.tasks.complete(acquired.id, requestId);
    this.publish(
      acquired,
      DebateProcessingStageStatus.COMPLETED,
      prefix,
      '완료',
    );
    await this.notify(acquired, 'COMPLETED');
  }

  // handler 실행에 타임아웃을 건다. LLM SDK가 멈춰도 작업이 PROCESSING으로 영영 남지 않게 한다.
  private async runWithTimeout(
    handler: JudgeTaskHandler,
    task: JudgeTask,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `작업이 ${this.config.jobTimeoutMs}ms 안에 끝나지 않았습니다.`,
            ),
          ),
        this.config.jobTimeoutMs,
      );
    });

    try {
      await Promise.race([handler.handle(task), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 실패 확정. 재시도 예산이 남아 있고 재시도 가능한 실패면 PENDING으로 되돌린 뒤 예외를
   * 다시 던져 BullMQ backoff에 맡기고, 그렇지 않으면 FAILED로 끝낸다.
   */
  private async settleFailure(
    task: JudgeTask,
    prefix: string | null,
    requestId: string,
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const retryable =
      !(error instanceof NonRetryableTaskError) &&
      task.attempt < task.maxAttempts;

    if (!retryable) {
      await this.settleFailed(task, prefix, requestId, reason);
      throw new UnrecoverableError(reason);
    }

    await this.tasks.release(task.id, requestId, reason);
    this.publish(
      task,
      DebateProcessingStageStatus.RETRYING,
      prefix,
      `재시도 예정 (${reason})`,
    );
    this.logger.warn(
      `작업 재시도 예정: kind=${task.kind}, taskId=${task.id}, attempt=${task.attempt}/${task.maxAttempts}, 원인=${reason}`,
    );
    throw error instanceof Error ? error : new Error(reason);
  }

  private async settleFailed(
    task: JudgeTask,
    prefix: string | null,
    requestId: string,
    reason: string,
  ): Promise<void> {
    await this.tasks.fail(task.id, requestId, reason);
    this.publish(
      task,
      DebateProcessingStageStatus.FAILED,
      prefix,
      `실패 (${reason})`,
    );
    this.logger.error(
      `작업 최종 실패: kind=${task.kind}, taskId=${task.id}, 원인=${reason}`,
    );
    await this.notify(task, 'FAILED');
  }

  // 확정 뒤 후속 판단(판정 조건 평가)은 실패해도 작업 결과를 뒤집지 않는다.
  private async notify(task: JudgeTask, outcome: TaskOutcome): Promise<void> {
    try {
      await this.listener.onTaskSettled(task, outcome);
    } catch (error: unknown) {
      this.logger.error(
        `작업 후속 처리 실패: kind=${task.kind}, taskId=${task.id}`,
        error,
      );
    }
  }

  // stage 메시지 접두사. 여기서 실패해도 본 작업을 막을 이유는 없다.
  private async describe(
    handler: JudgeTaskHandler,
    task: JudgeTask,
  ): Promise<string | null> {
    try {
      return await handler.describe(task);
    } catch {
      return null;
    }
  }

  /**
   * 작업 상태 전이를 debate room의 debate.processing.stage 이벤트로 옮긴다.
   *
   * worker가 다른 인스턴스에서 돌면 그 프로세스에 방이 없어 이벤트가 나가지 않는다.
   * 다중 인스턴스 Pub/Sub 전까지의 알려진 한계다.
   */
  private publish(
    task: JudgeTask,
    status: DebateProcessingStageStatus,
    prefix: string | null,
    summary: string,
  ): void {
    // 작업 종류와 계약 stage는 값이 같지만, 내부 열거형과 계약 열거형을 섞지 않도록 옮겨 담는다.
    const stage = STAGE_OF[task.kind];
    const message =
      prefix === null ? `${stage} ${summary}` : `${prefix} ${stage} ${summary}`;

    this.publisher.processingStage({
      debateId: task.debateId,
      stage,
      status,
      attempt: task.attempt,
      message,
      occurredAt: new Date().toISOString(),
    });

    // 같은 전이를 로그로도 남긴다. 소켓에 붙지 않고 돌려 볼 때 진행을 볼 곳이 여기뿐이다.
    this.logger.debug(
      `[${status}] debateId=${task.debateId}, ${message}, attempt=${task.attempt}/${task.maxAttempts}`,
    );
  }
}

const STAGE_OF: Record<JudgeTaskKind, DebateProcessingStage> = {
  [JudgeTaskKind.ANALYZER]: DebateProcessingStage.ANALYZER,
  [JudgeTaskKind.FACT_CHECK]: DebateProcessingStage.FACT_CHECK,
  [JudgeTaskKind.JUDGE]: DebateProcessingStage.JUDGE,
};
