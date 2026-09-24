import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';
import { JudgeTaskKind } from './judge.types';

// 작업은 LLM 호출을 품어 수 초~수십 초 걸린다. 상한은 DEBATE_PIPELINE_JOB_TIMEOUT_MS 기본값(120s)에 맞춘다.
const DURATION_BUCKETS_SECONDS = [0.5, 1, 2, 5, 10, 20, 30, 60, 90, 120];

export type JudgeTaskMetricOutcome = 'completed' | 'retry' | 'failed';

@Injectable()
export class JudgeTaskMetrics {
  private readonly total: Counter<'kind' | 'outcome'>;
  private readonly duration: Histogram<'kind' | 'outcome'>;

  constructor(registry: Registry) {
    this.total = new Counter({
      name: 'heimdall_judge_tasks_total',
      help: '처리된 판정 파이프라인 작업 시도 수',
      labelNames: ['kind', 'outcome'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'heimdall_judge_task_duration_seconds',
      help: '판정 파이프라인 작업의 handler 실행 시간(큐 대기·backoff 제외)',
      labelNames: ['kind', 'outcome'],
      buckets: DURATION_BUCKETS_SECONDS,
      registers: [registry],
    });
  }

  /**
   * 작업 시도 1건의 결과를 기록한다. handler를 실행하지 못한 시도(처리기 미등록)는
   * 소요 시간이 없으므로 durationSeconds를 null로 넘겨 횟수만 센다.
   */
  record(
    kind: JudgeTaskKind,
    outcome: JudgeTaskMetricOutcome,
    durationSeconds: number | null,
  ): void {
    this.total.inc({ kind, outcome });
    if (durationSeconds !== null) {
      this.duration.observe({ kind, outcome }, durationSeconds);
    }
  }
}
