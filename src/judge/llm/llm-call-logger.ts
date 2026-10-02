import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  formatLogFields,
  LogFieldValue,
} from '../../common/logging/log-fields';
import { LlmMetrics } from './llm.metrics';

// 호출을 도메인과 잇는 필드(debateId 등). 넘긴 순서대로 outcome 뒤에 찍힌다.
export type LlmLogContext = Readonly<Record<string, LogFieldValue>>;

// 어느 호출인지. operation은 analyze / judge.performance / judge.violation / fact_check 중 하나다.
export interface LlmCallMeta {
  provider: 'openai' | 'gemini';
  model: string;
  operation: string;
  // 로그에만 싣는다. debateId 같은 무한 값이 섞이므로 메트릭 label로 쓰면 안 된다.
  context?: LlmLogContext;
}

// 벤더마다 다른 usage 필드를 옮겨 담은 공통 모양. 벤더가 주지 않는 값은 null이다(로그에는 unknown).
export interface LlmTokenUsage {
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
}

const NO_USAGE: LlmTokenUsage = {
  inputTokens: null,
  cachedTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  totalTokens: null,
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

  /**
   * key=value 한 줄. 로그 수집기에서 필드로 뽑아 쓰기 쉽도록 순서를 고정한다.
   * 호출 식별 → 도메인 컨텍스트 → 소요 시간 → 토큰(input·cached·output·thinking·total) → 에러 순이다.
   */
  private format(
    meta: LlmCallMeta,
    outcome: 'SUCCESS' | 'FAILURE',
    durationMs: number,
    fields: LlmTokenUsage & { error?: string },
  ): string {
    return formatLogFields([
      ['provider', meta.provider],
      ['model', meta.model],
      ['operation', meta.operation],
      ['outcome', outcome],
      ...Object.entries(meta.context ?? {}),
      ['durationMs', durationMs],
      ['inputTokens', fields.inputTokens],
      ['cachedTokens', fields.cachedTokens],
      ['outputTokens', fields.outputTokens],
      ['thinkingTokens', fields.thinkingTokens],
      ['totalTokens', fields.totalTokens],
      ['error', fields.error],
    ]);
  }
}
