import { Module } from '@nestjs/common';
import { CommunitiesModule } from '../communities/communities.module';
import { CommunityChatPublisherModule } from '../community-chat/community-chat-publisher.module';
import { DebateChatPublisherModule } from '../debate-chat/debate-chat-publisher.module';
import { DebatesModule } from '../debates/debates.module';
import { MembersModule } from '../members/members.module';
import { DebateOutcomeService } from './debate-outcome.service';
import { DebateSystemMessageFactory } from './debate-system-message.factory';

@Module({
  // 토론 종료를 부르는 쪽(debate-chat·judge·debate-invitations)은 import하지 않는다 — 의존은 한 방향뿐이다.
  // 방 발행자는 leaf 모듈에서 받는다.
  imports: [
    CommunitiesModule,
    DebatesModule,
    MembersModule,
    CommunityChatPublisherModule,
    DebateChatPublisherModule,
  ],
  providers: [
    DebateOutcomeService,
    {
      provide: DebateSystemMessageFactory,
      useValue: new DebateSystemMessageFactory(),
    },
  ],
  exports: [DebateOutcomeService],
})
export class DebateOutcomesModule {}
