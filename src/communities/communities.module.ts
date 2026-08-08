import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesService } from './communities.service';
import { CommunitiesController } from './communities.controller';
import { Community } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { MembersModule } from '../members/members.module';
import { MemberCommunitiesModule } from '../member-communities/member-communities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Community, Theme, CommunityFavorite]),
    MembersModule,
    MemberCommunitiesModule,
  ],
  controllers: [CommunitiesController],
  providers: [CommunitiesService],
})
export class CommunitiesModule {}
