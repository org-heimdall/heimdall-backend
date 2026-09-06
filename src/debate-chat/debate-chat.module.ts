import { Module } from '@nestjs/common';
import { TokenModule } from '../auth/token.module';
import { DebatesModule } from '../debates/debates.module';
import {
  DEBATE_CHAT_STATE_STORE,
  InMemoryDebateChatStateStore,
} from './debate-chat-state.store';
import { DebateChatConfig } from './debate-chat.config';
import { DebateChatGateway } from './debate-chat.gateway';
import { DebateChatPublisher } from './debate-chat.publisher';
import { DebateChatService } from './debate-chat.service';
import {
  DEBATE_PROCESSING_PIPELINE,
  MockDebateProcessingPipeline,
} from './debate-processing-pipeline';

@Module({
  imports: [TokenModule, DebatesModule],
  providers: [
    DebateChatConfig,
    DebateChatPublisher,
    DebateChatService,
    DebateChatGateway,
    // Phase 1: 인메모리 상태 + mock 파이프라인. Phase 2/3에서 이 두 줄의 구현체만 교체한다.
    {
      provide: DEBATE_CHAT_STATE_STORE,
      useClass: InMemoryDebateChatStateStore,
    },
    {
      provide: DEBATE_PROCESSING_PIPELINE,
      useClass: MockDebateProcessingPipeline,
    },
  ],
  exports: [DebateChatService],
})
export class DebateChatModule {}
