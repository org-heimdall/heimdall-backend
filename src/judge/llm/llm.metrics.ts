import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';
import type { LlmCallMeta, LlmTokenUsage } from './llm-call-logger';

// LLM 호출은 수 초~수십 초 걸린다. 상한은 DEBATE_PIPELINE_JOB_TIMEOUT_MS 기본값(120s)에 맞춘다.
const DURATION_BUCKETS_SECONDS = [0.5, 1, 2, 5, 10, 20, 30, 60, 90, 120];

export type LlmCallOutcome = 'success' | 'failure';

// 토큰 종류 label과 usage 필드의 대응. OpenAI는 cached가 input에 포함되므로 합산하면 안 된다.
const TOKEN_TYPES = [
  ['input', 'inputTokens'],
  ['cached', 'cachedTokens'],
  ['output', 'outputTokens'],
  ['thinking', 'thinkingTokens'],
] as const satisfies readonly (readonly [string, keyof LlmTokenUsage])[];

@Injectable()
export class LlmMetrics {
  private readonly duration: Histogram<
    'provider' | 'model' | 'operation' | 'outcome'
  >;
  private readonly tokens: Counter<'provider' | 'model' | 'operation' | 'type'>;

  constructor(registry: Registry) {
    this.duration = new Histogram({
      name: 'heimdall_llm_call_duration_seconds',
      help: 'LLM 호출 1건의 소요 시간',
      labelNames: ['provider', 'model', 'operation', 'outcome'],
      buckets: DURATION_BUCKETS_SECONDS,
      registers: [registry],
    });
    this.tokens = new Counter({
      name: 'heimdall_llm_tokens_total',
      help: 'LLM 호출이 사용한 토큰 수(type: input·cached·output·thinking)',
      labelNames: ['provider', 'model', 'operation', 'type'],
      registers: [registry],
    });
  }

  // 호출 1건을 기록한다. 벤더가 주지 않은 토큰 값(null)은 건너뛴다(0으로 세면 실측과 섞인다).
  record(
    meta: LlmCallMeta,
    outcome: LlmCallOutcome,
    durationSeconds: number,
    usage: LlmTokenUsage,
  ): void {
    const { provider, model, operation } = meta;
    this.duration.observe(
      { provider, model, operation, outcome },
      durationSeconds,
    );

    for (const [type, field] of TOKEN_TYPES) {
      const value = usage[field];
      if (value !== null && value > 0) {
        this.tokens.inc({ provider, model, operation, type }, value);
      }
    }
  }
}
