import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenModule } from '../auth/token.module';
import { RedisModule } from '../common/redis/redis.module';
import { DebatesModule } from '../debates/debates.module';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { Debate } from '../debates/entities/debate.entity';
import {
  DEBATE_CHAT_STATE_STORE,
  RedisDebateChatStateStore,
} from './debate-chat-state.store';
import { DebateChatConfig } from './debate-chat.config';
import { DebateChatController } from './debate-chat.controller';
import { DebateLifecycleController } from './debate-lifecycle.controller';
import { DebateChatGateway } from './debate-chat.gateway';
import { DebateChatPublisher } from './debate-chat.publisher';
import { DebateChatService } from './debate-chat.service';
import { DebateTurnTimeoutScheduler } from './debate-turn-timeout.scheduler';
import {
  DEBATE_PROCESSING_PIPELINE,
  MockDebateProcessingPipeline,
} from './debate-processing-pipeline';

@Module({
  imports: [
    TokenModule,
    DebatesModule,
    RedisModule,
    // 확정 턴 저장과 토론 상태 갱신은 저장소가 직접 한다(judge 모듈과 같은 방식).
    TypeOrmModule.forFeature([Debate, DebateMessage]),
  ],
  controllers: [DebateChatController, DebateLifecycleController],
  providers: [
    DebateChatConfig,
    DebateChatPublisher,
    DebateChatService,
    DebateChatGateway,
    DebateTurnTimeoutScheduler,
    // 상태는 Redis(draft·락) + Postgres(확정 턴). 파이프라인은 Phase 3에서 LLM 구현체로 교체한다.
    {
      provide: DEBATE_CHAT_STATE_STORE,
      useClass: RedisDebateChatStateStore,
    },
    {
      provide: DEBATE_PROCESSING_PIPELINE,
      useClass: MockDebateProcessingPipeline,
    },
  ],
  exports: [DebateChatService],
})
export class DebateChatModule {}
