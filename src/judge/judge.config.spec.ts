import { ConfigService } from '@nestjs/config';
import { JudgeConfig } from './judge.config';
import { JudgeTaskKind } from './judge.types';

describe('JudgeConfig', () => {
  const DEFAULTS: Record<string, unknown> = {
    DEBATE_PIPELINE_WORKER_CONCURRENCY: 2,
    DEBATE_PIPELINE_JOB_TIMEOUT_MS: 120000,
    DEBATE_PIPELINE_BACKOFF_MS: 5000,
    DEBATE_PIPELINE_ANALYZER_MAX_ATTEMPTS: 3,
    DEBATE_PIPELINE_FACT_CHECK_MAX_ATTEMPTS: 3,
    DEBATE_PIPELINE_JUDGE_MAX_ATTEMPTS: 2,
    DEBATE_JUDGE_RETRY_COOLDOWN_SECONDS: 300,
    OPENAI_API_KEY: 'sk-test',
    GEMINI_API_KEY: 'gemini-test',
  };

  const build = (overrides: Record<string, unknown> = {}) => {
    const values = { ...DEFAULTS, ...overrides };
    const configService = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        const value = values[key];
        if (value === undefined) {
          throw new Error(`missing: ${key}`);
        }
        return value;
      },
    } as unknown as ConfigService;

    return new JudgeConfig(configService);
  };

  it('작업 종류별 재시도 상한을 읽는다', () => {
    const config = build();

    expect(config.maxAttempts).toEqual({
      [JudgeTaskKind.ANALYZER]: 3,
      [JudgeTaskKind.FACT_CHECK]: 3,
      [JudgeTaskKind.JUDGE]: 2,
    });
    expect(config.judgeRetryCooldownSeconds).toBe(300);
  });
});
