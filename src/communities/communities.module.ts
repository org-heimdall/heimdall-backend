import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesService } from './communities.service';
import { CommunityMessagesService } from './community-messages.service';
import { CommunitiesController } from './communities.controller';
import { Community } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { CommunityMessage } from './entities/community-message.entity';
import { MembersModule } from '../members/members.module';
import { MemberCommunitiesModule } from '../member-communities/member-communities.module';
import { CommunityChatPublisherModule } from '../community-chat/community-chat-publisher.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Community,
      Theme,
      CommunityFavorite,
      CommunityMessage,
    ]),
    MembersModule,
    MemberCommunitiesModule,
    // 토론 의사 변경을 커뮤니티 방에 알린다. 발행자만 담은 leaf 모듈이라 순환이 생기지 않는다
    // (커뮤니티 채팅 컨트롤러가 REST에서 발행하는 것과 같은 방식).
    CommunityChatPublisherModule,
  ],
  controllers: [CommunitiesController],
  providers: [CommunitiesService, CommunityMessagesService],
  // 토론 생성이 커뮤니티 존재·설정을 이 서비스로만 읽는다(엔티티 직접 참조 대신).
  // 커뮤니티 채팅은 메시지 저장소를 이 모듈에서 받아 쓴다.
  exports: [CommunitiesService, CommunityMessagesService],
})
export class CommunitiesModule {}
