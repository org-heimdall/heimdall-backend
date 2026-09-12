import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JudgeTaskKind, JudgeTaskStatus } from './judge.types';
import { JudgeTask } from './entities/judge-task.entity';

export interface CreateTaskInput {
  debateId: string;
  kind: JudgeTaskKind;
  targetId: string;
  maxAttempts: number;
}

// 한 토론의 종류별 작업 집계. readiness 판단이 이 한 번으로 조건을 다 본다.
export interface TaskStatusCounts {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

const EMPTY_COUNTS: TaskStatusCounts = {
  total: 0,
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
};

const STATUS_FIELD: Record<
  JudgeTaskStatus,
  keyof Omit<TaskStatusCounts, 'total'>
> = {
  [JudgeTaskStatus.PENDING]: 'pending',
  [JudgeTaskStatus.PROCESSING]: 'processing',
  [JudgeTaskStatus.COMPLETED]: 'completed',
  [JudgeTaskStatus.FAILED]: 'failed',
};

/**
 * 작업 테이블 접근과 상태 전이. "같은 작업이 두 번 실행되지 않는다"는 성질이 전부 여기 모여 있다.
 *
 * 규칙은 둘뿐이다.
 * 1. 생성은 (kind, target_id) unique + ON CONFLICT DO NOTHING으로 멱등하다.
 * 2. 모든 상태 전이는 조건부 UPDATE 한 번이며(read-then-write 아님), 결과 반영은 이번 시도가
 *    여전히 선점자일 때(request_id 일치, 상태 PROCESSING)만 이뤄진다 — 늦게 온 옛 시도는 버려진다.
 */
@Injectable()
export class JudgeTaskRepository {
  constructor(
    @InjectRepository(JudgeTask)
    private readonly repository: Repository<JudgeTask>,
  ) {}

  /**
   * 멱등 생성. 이미 같은 대상의 작업이 있으면 만들지 않고 그 행을 돌려준다.
   * 방금 만들어졌든 재시작으로 남아 있었든, 아직 시작 전(PENDING)이면 호출자가 큐에 올린다.
   */
  async createIfAbsent(input: CreateTaskInput): Promise<JudgeTask> {
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(JudgeTask)
      .values({
        debateId: input.debateId,
        kind: input.kind,
        targetId: input.targetId,
        maxAttempts: input.maxAttempts,
        status: JudgeTaskStatus.PENDING,
        attempt: 0,
      })
      .orIgnore()
      .execute();

    const task = await this.findByTarget(input.kind, input.targetId);
    if (task === null) {
      // 방금 만들었거나 이미 있어야 하는 행이므로, 없으면 데이터 이상이다.
      throw new Error(
        `작업 행을 찾지 못했습니다: kind=${input.kind}, targetId=${input.targetId}`,
      );
    }
    return task;
  }

  /**
   * PENDING인 작업을 이번 시도(requestId)로 선점한다. 성공하면 attempt가 1 오른 행을,
   * 다른 worker가 먼저 가져갔거나 이미 끝난 작업이면 null을 돌려준다.
   */
  async acquire(taskId: string, requestId: string): Promise<JudgeTask | null> {
    const result = await this.repository
      .createQueryBuilder()
      .update(JudgeTask)
      .set({
        status: JudgeTaskStatus.PROCESSING,
        requestId,
        attempt: () => '"attempt" + 1',
        updatedAt: () => 'now()',
      })
      .where('id = :taskId', { taskId })
      .andWhere('status = :status', {
        status: JudgeTaskStatus.PENDING,
      })
      .execute();

    if ((result.affected ?? 0) === 0) {
      return null;
    }
    return this.repository.findOneBy({ id: taskId });
  }

  // 성공 확정. 이번 시도가 여전히 선점자일 때만 반영된다.
  async complete(taskId: string, requestId: string): Promise<boolean> {
    return this.settle(taskId, requestId, {
      status: JudgeTaskStatus.COMPLETED,
      lastError: null,
    });
  }

  // 최종 실패(재시도 소진 또는 재시도 불가). 이 상태는 /judge/retry로만 풀린다.
  async fail(
    taskId: string,
    requestId: string,
    lastError: string,
  ): Promise<boolean> {
    return this.settle(taskId, requestId, {
      status: JudgeTaskStatus.FAILED,
      lastError,
    });
  }

  // 재시도 가능한 실패. PENDING으로 돌려놓아 backoff 뒤 다른 시도가 선점할 수 있게 한다.
  async release(
    taskId: string,
    requestId: string,
    lastError: string,
  ): Promise<boolean> {
    return this.settle(taskId, requestId, {
      status: JudgeTaskStatus.PENDING,
      lastError,
      requestId: null,
    });
  }

  /**
   * FAILED인 작업을 PENDING으로 되돌린다(POST /judge/retry). 시도 횟수도 초기화해
   * 재시도에 온전한 예산을 준다. 되돌린 작업을 돌려주며, 호출자가 다시 큐에 넣는다.
   */
  async resetFailed(
    debateId: string,
    kinds: JudgeTaskKind[],
  ): Promise<JudgeTask[]> {
    const failed = await this.findFailed(debateId, kinds);
    if (failed.length === 0) {
      return [];
    }

    const ids = failed.map((task) => task.id);
    await this.repository
      .createQueryBuilder()
      .update(JudgeTask)
      .set({
        status: JudgeTaskStatus.PENDING,
        attempt: 0,
        requestId: null,
        updatedAt: () => 'now()',
      })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :status', {
        status: JudgeTaskStatus.FAILED,
      })
      .execute();

    return this.repository.findBy({ id: In(ids) });
  }

  /**
   * 프로세스가 죽어 PROCESSING으로 남은 작업을 PENDING으로 되돌린다(부팅 복구).
   *
   * 선점한 worker가 사라지면 그 행은 아무도 손대지 못한 채 남는다. 정상적인 실행이라면
   * 끝났어야 할 시각(staleBefore)을 넘긴 것만 되돌리며, 시도 횟수는 그대로 두어
   * 재시도 예산을 소모한 사실을 잃지 않는다.
   */
  async reclaimStale(staleBefore: Date): Promise<JudgeTask[]> {
    const stale = await this.repository
      .createQueryBuilder('task')
      .where('task.status = :status', {
        status: JudgeTaskStatus.PROCESSING,
      })
      .andWhere('task.updated_at < :staleBefore', { staleBefore })
      .getMany();
    if (stale.length === 0) {
      return [];
    }

    const ids = stale.map((task) => task.id);
    await this.repository
      .createQueryBuilder()
      .update(JudgeTask)
      .set({
        status: JudgeTaskStatus.PENDING,
        requestId: null,
        updatedAt: () => 'now()',
      })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :status', {
        status: JudgeTaskStatus.PROCESSING,
      })
      .execute();

    return this.repository.findBy({ id: In(ids) });
  }

  // 아직 시작되지 않은 작업 전부. 부팅 시 큐에 다시 넣어 재시작 전 진행을 이어 간다.
  async findPending(): Promise<JudgeTask[]> {
    return this.repository.findBy({
      status: JudgeTaskStatus.PENDING,
    });
  }

  // 최종 실패한 작업. 재시도 쿨다운(J2)은 이들의 마지막 전이 시각을 기준으로 잰다.
  async findFailed(
    debateId: string,
    kinds: JudgeTaskKind[],
  ): Promise<JudgeTask[]> {
    return this.repository.findBy({
      debateId,
      kind: In(kinds),
      status: JudgeTaskStatus.FAILED,
    });
  }

  async findById(taskId: string): Promise<JudgeTask | null> {
    return this.repository.findOneBy({ id: taskId });
  }

  async findByTarget(
    kind: JudgeTaskKind,
    targetId: string,
  ): Promise<JudgeTask | null> {
    return this.repository.findOneBy({ kind, targetId });
  }

  // 종류별 상태 집계. readiness가 "분석 전부 완료 · 검증 진행 중 없음"을 이 한 번으로 본다.
  async countByKind(
    debateId: string,
  ): Promise<Record<JudgeTaskKind, TaskStatusCounts>> {
    const tasks = await this.repository.findBy({ debateId });
    const counts: Record<JudgeTaskKind, TaskStatusCounts> = {
      [JudgeTaskKind.ANALYZER]: { ...EMPTY_COUNTS },
      [JudgeTaskKind.FACT_CHECK]: { ...EMPTY_COUNTS },
      [JudgeTaskKind.JUDGE]: { ...EMPTY_COUNTS },
    };

    for (const task of tasks) {
      const bucket = counts[task.kind];
      bucket.total += 1;
      bucket[STATUS_FIELD[task.status]] += 1;
    }
    return counts;
  }

  // 상태 전이의 공통부. 이번 시도가 선점 중인 PROCESSING일 때만 반영한다.
  private async settle(
    taskId: string,
    requestId: string,
    values: Partial<Pick<JudgeTask, 'status' | 'lastError' | 'requestId'>>,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(JudgeTask)
      .set({ ...values, updatedAt: () => 'now()' })
      .where('id = :taskId', { taskId })
      .andWhere('status = :status', {
        status: JudgeTaskStatus.PROCESSING,
      })
      .andWhere('request_id = :requestId', { requestId })
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
