import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesModule } from '../communities/communities.module';
import { MemberCommunitiesModule } from '../member-communities/member-communities.module';
import { MembersModule } from '../members/members.module';
import { DebatesService } from './debates.service';
import { DebatesController } from './debates.controller';
import { DebateMessageLike } from './entities/debate-message-like.entity';
import { DebateMessage } from './entities/debate-message.entity';
import { Debate } from './entities/debate.entity';

@Module({
  imports: [
    // 토론·확정 턴·턴 투표는 모두 이 도메인이 소유한다.
    TypeOrmModule.forFeature([Debate, DebateMessage, DebateMessageLike]),
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
  ],
  controllers: [DebatesController],
  providers: [DebatesService],
  // 토론 채팅 등 다른 도메인은 이 서비스로만 debate를 조회한다(엔티티 직접 참조 대신).
  exports: [DebatesService],
})
export class DebatesModule {}
