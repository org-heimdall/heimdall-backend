import { Module } from '@nestjs/common';
import { TokenModule } from '../auth/token.module';
import { CommunitiesModule } from '../communities/communities.module';
import { MemberCommunitiesModule } from '../member-communities/member-communities.module';
import { MembersModule } from '../members/members.module';
import { CommunityChatPublisherModule } from './community-chat-publisher.module';
import { CommunityChatController } from './community-chat.controller';
import { CommunityChatGateway } from './community-chat.gateway';
import { CommunityChatService } from './community-chat.service';

@Module({
  imports: [
    TokenModule,
    // 메시지·기조 발언·회원은 각 소유 도메인의 서비스로만 읽고 쓴다(엔티티 직접 참조 대신).
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
    CommunityChatPublisherModule,
  ],
  controllers: [CommunityChatController],
  providers: [CommunityChatService, CommunityChatGateway],
  exports: [CommunityChatService],
})
export class CommunityChatModule {}
