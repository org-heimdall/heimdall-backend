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
import { DebateChatPublisherModule } from './debate-chat-publisher.module';
import { DebateChatController } from './debate-chat.controller';
import { DebateLifecycleController } from './debate-lifecycle.controller';
import { DebateChatGateway } from './debate-chat.gateway';
import { DebateChatService } from './debate-chat.service';
import { DebateTurnTimeoutScheduler } from './debate-turn-timeout.scheduler';
import { JudgeModule } from '../judge/judge.module';

@Module({
  imports: [
    TokenModule,
    DebatesModule,
    RedisModule,
    DebateChatPublisherModule,
    // 확정된 턴을 처리(Analyzer→FactCheck→Judge)로 넘기는 파이프라인은 이 모듈이 제공한다.
    JudgeModule,
    // 확정 턴 저장과 토론 상태 갱신은 저장소가 직접 한다(judge 모듈과 같은 방식).
    TypeOrmModule.forFeature([Debate, DebateMessage]),
  ],
  controllers: [DebateChatController, DebateLifecycleController],
  providers: [
    DebateChatConfig,
    DebateChatService,
    DebateChatGateway,
    DebateTurnTimeoutScheduler,
    // 상태는 Redis(draft·락) + Postgres(확정 턴).
    {
      provide: DEBATE_CHAT_STATE_STORE,
      useClass: RedisDebateChatStateStore,
    },
  ],
  exports: [DebateChatService],
})
export class DebateChatModule {}
