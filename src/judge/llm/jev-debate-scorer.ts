import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeSafeClient, type Usage } from '@typesafe-ai/sdk';
import { NonRetryableTaskError } from '../judge-task.worker';
import {
  buildJevQuestions,
  buildJevState,
  toDebateScoring,
} from './jev-judge-questions';
import { DebateJudgeRequest, DebateScoring, JudgeScorer } from './judge-llm';
import { LlmCallLogger, LlmTokenUsage } from './llm-call-logger';

// 3단계(Debate Judge)의 점수·위반 판정은 TypeSafe Jev 사용. 문장은 JudgeCommentator가 쓴다.
@Injectable()
export class JevDebateScorer implements JudgeScorer {
  private readonly logger = new Logger(JevDebateScorer.name);
  private readonly model: string;
  private readonly client: TypeSafeClient | null;

  constructor(
    configService: ConfigService,
    private readonly callLogger: LlmCallLogger,
  ) {
    this.model = configService.getOrThrow<string>('TYPESAFE_MODEL');

    const apiKey = configService.get<string>('TYPESAFE_API_KEY');
    if (!apiKey) {
      // SDK는 키가 없으면 생성자에서 던지므로 만들기 전에 거른다.
      this.client = null;
      this.logger.warn('TYPESAFE_API_KEY가 없어 판정을 사용할 수 없습니다.');
      return;
    }
    this.client = new TypeSafeClient({
      apiKey,
      defaultModel: this.model,
      timeout: configService.getOrThrow<number>('TYPESAFE_TIMEOUT_MS'),
      retry: {
        maxRetries: configService.getOrThrow<number>('TYPESAFE_MAX_RETRIES'),
      },
    });
  }

  // 점수 3축과 위반 판정을 한 번의 호출로 묻는다. 질문들은 서로 독립이라 Jev가 병렬로 답한다.
  async score(request: DebateJudgeRequest): Promise<DebateScoring> {
    if (this.client === null) {
      // 키가 없는 상태는 재시도로 나아지지 않는다.
      throw new NonRetryableTaskError(
        'TYPESAFE_API_KEY가 없어 실행할 수 없습니다.',
      );
    }

    const client = this.client;
    const result = await this.callLogger.measure(
      {
        provider: 'typesafe',
        model: this.model,
        operation: 'judge.score',
        context: request.logContext,
      },
      () =>
        client.systemOne({
          state: buildJevState(request),
          questions: buildJevQuestions(request),
        }),
      (response) => toTokenUsage(response.usage),
    );

    return toDebateScoring(request, result.answers, result.model);
  }
}

// TypeSafe usage를 공통 로그 모양으로 옮긴다. 캐시·추론 토큰 개념이 없어 null로 둔다.
function toTokenUsage(usage: Usage | undefined): LlmTokenUsage {
  const input = usage?.input_tokens ?? null;
  const output = usage?.output_tokens ?? null;
  return {
    inputTokens: input,
    cachedTokens: null,
    outputTokens: output,
    thinkingTokens: null,
    totalTokens: input === null || output === null ? null : input + output,
  };
}
