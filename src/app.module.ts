import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommunitiesModule } from './communities/communities.module';
import { MemberCommunitiesModule } from './member-communities/member-communities.module';
import { MembersModule } from './members/members.module';

@Module({
  imports: [CommunitiesModule, MemberCommunitiesModule, MembersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
