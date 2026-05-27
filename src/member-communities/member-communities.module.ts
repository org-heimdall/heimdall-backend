import { Module } from '@nestjs/common';
import { MemberCommunitiesService } from './member-communities.service';
import { MemberCommunitiesController } from './member-communities.controller';

@Module({
  controllers: [MemberCommunitiesController],
  providers: [MemberCommunitiesService],
})
export class MemberCommunitiesModule {}
