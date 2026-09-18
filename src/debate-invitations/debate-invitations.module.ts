import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CLOCK, systemClock } from '../common/scheduling/clock';
import { CommunitiesModule } from '../communities/communities.module';
import { CommunityChatPublisherModule } from '../community-chat/community-chat-publisher.module';
import { DebateChatModule } from '../debate-chat/debate-chat.module';
import { DebatesModule } from '../debates/debates.module';
import { MemberCommunitiesModule } from '../member-communities/member-communities.module';
import { MembersModule } from '../members/members.module';
import { DebateInvitationExpiryScheduler } from './debate-invitation-expiry.scheduler';
import { DebateInvitationsConfig } from './debate-invitations.config';
import { DebateInvitationsController } from './debate-invitations.controller';
import { DebateInvitationsService } from './debate-invitations.service';
import { DebateInvitation } from './entities/debate-invitation.entity';

@Module({
  imports: [
    // 초대는 이 도메인이 소유한다. 커뮤니티·회원·토론은 각 도메인의 서비스로만 읽고 쓴다.
    TypeOrmModule.forFeature([DebateInvitation]),
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
    DebatesModule,
    // 수락과 동시에 토론을 시작하기 위해 토론 채팅 서비스를 쓴다.
    // 토론 채팅은 이 모듈을 모르므로 순환이 생기지 않는다.
    DebateChatModule,
    CommunityChatPublisherModule,
  ],
  controllers: [DebateInvitationsController],
  providers: [
    DebateInvitationsConfig,
    DebateInvitationsService,
    DebateInvitationExpiryScheduler,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [DebateInvitationsService],
})
export class DebateInvitationsModule {}
