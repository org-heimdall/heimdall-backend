import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JudgeTaskKind } from './judge.types';

// 작업 종류별 재시도 상한. 실패가 곧 비용이므로 종류마다 따로 둔다.
export type MaxAttemptsByKind = Record<JudgeTaskKind, number>;

/**
 * 파이프라인 운영 설정. 값 검증은 app.module의 Joi 스키마가 하고, 여기서는 읽어서 묶고
 * 시작 로그로 실제 값을 남긴다(내부 설계 "운영·오류 처리").
 */
@Injectable()
export class JudgeConfig {
  readonly workerConcurrency: number;
  readonly jobTimeoutMs: number;
  readonly backoffMs: number;
  readonly maxAttempts: MaxAttemptsByKind;
  readonly judgeRetryCooldownSeconds: number;

  constructor(configService: ConfigService) {
    this.workerConcurrency = configService.getOrThrow<number>(
      'DEBATE_PIPELINE_WORKER_CONCURRENCY',
    );
    this.jobTimeoutMs = configService.getOrThrow<number>(
      'DEBATE_PIPELINE_JOB_TIMEOUT_MS',
    );
    this.backoffMs = configService.getOrThrow<number>(
      'DEBATE_PIPELINE_BACKOFF_MS',
    );
    this.maxAttempts = {
      [JudgeTaskKind.ANALYZER]: configService.getOrThrow<number>(
        'DEBATE_PIPELINE_ANALYZER_MAX_ATTEMPTS',
      ),
      [JudgeTaskKind.FACT_CHECK]: configService.getOrThrow<number>(
        'DEBATE_PIPELINE_FACT_CHECK_MAX_ATTEMPTS',
      ),
      [JudgeTaskKind.JUDGE]: configService.getOrThrow<number>(
        'DEBATE_PIPELINE_JUDGE_MAX_ATTEMPTS',
      ),
    };
    this.judgeRetryCooldownSeconds = configService.getOrThrow<number>(
      'DEBATE_JUDGE_RETRY_COOLDOWN_SECONDS',
    );

    new Logger(JudgeConfig.name).log(
      `토론 판정 파이프라인 concurrency=${this.workerConcurrency}, ` +
        `timeout=${this.jobTimeoutMs}ms, backoff=${this.backoffMs}ms, ` +
        `attempts=(analyzer=${this.maxAttempts.ANALYZER}, factCheck=${this.maxAttempts.FACT_CHECK}, judge=${this.maxAttempts.JUDGE}), ` +
        `judgeRetryCooldown=${this.judgeRetryCooldownSeconds}s`,
    );
  }
}
