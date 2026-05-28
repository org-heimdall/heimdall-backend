import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommunitiesModule } from './communities/communities.module';
import { MemberCommunitiesModule } from './member-communities/member-communities.module';
import { MembersModule } from './members/members.module';
import { DebatesModule } from './debates/debates.module';

@Module({
  imports: [CommunitiesModule, MemberCommunitiesModule, MembersModule, DebatesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
