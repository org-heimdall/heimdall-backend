import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemberCommunitiesService } from './member-communities.service';
import { MemberCommunity } from './entities/member-community.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MemberCommunity])],
  controllers: [],
  providers: [MemberCommunitiesService],
  exports: [MemberCommunitiesService],
})
export class MemberCommunitiesModule {}
