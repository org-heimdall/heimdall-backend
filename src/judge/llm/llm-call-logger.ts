import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { LlmMetrics } from './llm.metrics';

// 어느 호출인지. operation은 analyze / judge.performance / judge.violation / fact_check 중 하나다.
export interface LlmCallMeta {
  provider: 'openai' | 'gemini';
  model: string;
  operation: string;
}

// 벤더마다 다른 usage 필드를 옮겨 담은 공통 모양. 벤더가 주지 않는 값은 null이다.
export interface LlmTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
}

const NO_USAGE: LlmTokenUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedTokens: null,
  reasoningTokens: null,
};

@Injectable()
export class LlmCallLogger {
  private readonly logger = new Logger('LlmCall');
  private readonly now: () => number = () => performance.now();

  constructor(private readonly metrics: LlmMetrics) {}

  /**
   * LLM 호출 하나의 소요 시간과 token usage를 한 줄로 남긴다. 성공이든 실패든 반드시 남긴다.
   * 프롬프트·응답 원문은 발언 내용이 섞이므로 남기지 않는다. 실패는 usage 없이 에러 이름만 남기고
   * 예외는 그대로 다시 던진다(재시도 판단은 호출자 몫이다). 같은 지점에서 메트릭도 기록한다.
   */
  async measure<T>(
    meta: LlmCallMeta,
    call: () => Promise<T>,
    extractUsage: (result: T) => LlmTokenUsage,
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await call();
      const durationMs = this.elapsed(startedAt);
      const usage = this.safeUsage(result, extractUsage);
      this.logger.log(this.format(meta, 'SUCCESS', durationMs, usage));
      this.metrics.record(meta, 'success', durationMs / 1000, usage);
      return result;
    } catch (error: unknown) {
      const durationMs = this.elapsed(startedAt);
      this.logger.warn(
        this.format(meta, 'FAILURE', durationMs, {
          ...NO_USAGE,
          error: error instanceof Error ? error.name : typeof error,
        }),
      );
      this.metrics.record(meta, 'failure', durationMs / 1000, NO_USAGE);
      throw error;
    }
  }

  private elapsed(startedAt: number): number {
    return Math.round(this.now() - startedAt);
  }

  // usage 추출이 실패해도 호출 결과를 버리지 않는다(관측성 때문에 기능이 깨지면 안 된다).
  private safeUsage<T>(
    result: T,
    extractUsage: (result: T) => LlmTokenUsage,
  ): LlmTokenUsage {
    try {
      return extractUsage(result);
    } catch {
      return NO_USAGE;
    }
  }

  // key=value 한 줄. 로그 수집기에서 필드로 뽑아 쓰기 쉽도록 순서를 고정한다.
  private format(
    meta: LlmCallMeta,
    outcome: 'SUCCESS' | 'FAILURE',
    durationMs: number,
    fields: LlmTokenUsage & { error?: string },
  ): string {
    const entries: [string, string | number | null | undefined][] = [
      ['provider', meta.provider],
      ['model', meta.model],
      ['operation', meta.operation],
      ['outcome', outcome],
      ['durationMs', durationMs],
      ['inputTokens', fields.inputTokens],
      ['outputTokens', fields.outputTokens],
      ['totalTokens', fields.totalTokens],
      ['cachedTokens', fields.cachedTokens],
      ['reasoningTokens', fields.reasoningTokens],
      ['error', fields.error],
    ];
    return entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value ?? 'null'}`)
      .join(' ');
  }
}
