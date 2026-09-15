import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DebateChatPublisherModule } from '../debate-chat/debate-chat-publisher.module';
import { DebatesModule } from '../debates/debates.module';
import { MembersModule } from '../members/members.module';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import { ArgumentAnalyzerService } from './argument-analyzer.service';
import { FactCheckerService } from './fact-checker.service';
import { DebateJudgeService } from './debate-judge.service';
import { JudgeConfig } from './judge.config';
import { JudgeController } from './judge.controller';
import { JudgeTaskRepository } from './judge-task.repository';
import { JudgeService } from './judge.service';
import {
  BULLMQ_CONNECTION,
  createBullMqConnection,
  JUDGE_TASK_HANDLERS,
  JUDGE_TASK_LISTENER,
  JudgeTaskQueue,
  JudgeTaskWorker,
} from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import {
  DebateArgumentComponent,
  DebateArgumentRelation,
} from './entities/debate-argument.entity';
import { DebateFactCheckResult } from './entities/debate-fact-check.entity';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { ARGUMENT_ANALYZER, DEBATE_JUDGE, FACT_CHECKER } from './llm/judge-llm';
import { GeminiFactChecker } from './llm/gemini-fact-checker';
import { OpenAiJudgeLlm } from './llm/openai-judge-llm';

/**
 * 토론 처리 파이프라인(Phase 3). 채팅이 넘겨 준 확정 턴을 작업으로 쌓고, worker가 Analyzer →
 * FactCheck → Judge를 실행해 결과를 남긴다.
 *
 * 채팅(DebateChatModule)이 이 모듈을 가져다 쓰므로 의존 방향은 채팅 → 처리 한쪽뿐이고,
 * 양쪽이 함께 쓰는 방 발행자는 DebateChatPublisherModule로 내려 두었다.
 */
@Module({
  imports: [
    DebatesModule,
    // 위반에 따른 신뢰도 차감(deductSocialCredit)만 쓴다.
    MembersModule,
    DebateChatPublisherModule,
    TypeOrmModule.forFeature([
      JudgeTask,
      DebateArgumentComponent,
      DebateArgumentRelation,
      DebateFactCheckResult,
      DebateJudgmentResult,
      // 토론 상태 전이와 전사 조회는 judge 모듈과 같은 방식으로 저장소가 직접 한다.
      Debate,
      DebateMessage,
    ]),
  ],
  controllers: [JudgeController],
  providers: [
    JudgeConfig,
    // BullMQ는 blocking 명령을 쓰므로 채팅용 Redis 연결과 반드시 분리한다.
    {
      provide: BULLMQ_CONNECTION,
      inject: [ConfigService],
      useFactory: createBullMqConnection,
    },
    JudgeTaskRepository,
    JudgeResultRepository,
    JudgeTaskQueue,
    JudgeTaskWorker,
    JudgeService,
    ArgumentAnalyzerService,
    FactCheckerService,
    DebateJudgeService,
    // LLM 구현체. 벤더는 단계마다 다르다 — 사실 검증만 Gemini(Google Search grounding).
    OpenAiJudgeLlm,
    { provide: ARGUMENT_ANALYZER, useExisting: OpenAiJudgeLlm },
    { provide: DEBATE_JUDGE, useExisting: OpenAiJudgeLlm },
    { provide: FACT_CHECKER, useClass: GeminiFactChecker },
    // 작업이 확정될 때마다 판정 조건을 다시 보는 것은 파이프라인 서비스의 몫이다.
    {
      provide: JUDGE_TASK_LISTENER,
      useExisting: JudgeService,
    },
    {
      provide: JUDGE_TASK_HANDLERS,
      inject: [ArgumentAnalyzerService, FactCheckerService, DebateJudgeService],
      useFactory: (
        analyzer: ArgumentAnalyzerService,
        factCheck: FactCheckerService,
        judge: DebateJudgeService,
      ) => [analyzer, factCheck, judge],
    },
  ],
  // 채팅이 확정 턴을 넘길 때 쓴다(onTurnFinalized/onDebateEnded).
  exports: [JudgeService],
})
export class JudgeModule implements OnApplicationShutdown {
  constructor(@Inject(BULLMQ_CONNECTION) private readonly connection: Redis) {}

  // 종료 시그널에서 큐 전용 연결을 정리한다(큐·worker 자신은 각자 close한다).
  async onApplicationShutdown(): Promise<void> {
    await this.connection.quit();
  }
}
