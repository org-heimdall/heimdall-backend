import { Module } from '@nestjs/common';
import { MemberCommunitiesService } from './member-communities.service';

@Module({
  controllers: [],
  providers: [MemberCommunitiesService],
})
export class MemberCommunitiesModule {}
