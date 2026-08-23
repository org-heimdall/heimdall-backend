import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenModule } from '../auth/token.module';
import { CommunitiesModule } from '../communities/communities.module';
import { MemberCommunitiesModule } from '../member-communities/member-communities.module';
import { MembersModule } from '../members/members.module';
import { DebateRoomService } from './room/debate-room.service';
import { DebateTimerService } from './room/debate-timer.service';
import { DebatesController } from './debates.controller';
import { DebatesGateway } from './room/debates.gateway';
import { DebatesService } from './debates.service';
import { DebateMessage } from './entities/debate-message.entity';
import { Debate } from './entities/debate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Debate, DebateMessage]),
    TokenModule,
    CommunitiesModule,
    MemberCommunitiesModule,
    MembersModule,
  ],
  controllers: [DebatesController],
  providers: [
    DebatesService,
    DebateRoomService,
    DebateTimerService,
    DebatesGateway,
  ],
})
export class DebatesModule {}
