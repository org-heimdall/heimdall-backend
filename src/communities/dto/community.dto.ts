import { ApiProperty } from '@nestjs/swagger';
import { PageInfo } from '../../common/dto/pageInfo.dto';
import { Community } from '../entities/community.entity';
import { Member } from '../../members/entities/member.entity';

export class CommunityDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  communityId: string;

  @ApiProperty({ example: 'WAITING' })
  state: string;

  @ApiProperty({ example: 'AI 규제, 필요한가?' })
  topic: string;

  @ApiProperty({ example: 1 })
  memberCount: number;

  @ApiProperty({
    example: 'https://cdn.example.com/profile/1.png',
    nullable: true,
  })
  hostProfileImageUrl: string | null;

  @ApiProperty({ nullable: true, description: 'debate 미구현으로 현재 null' })
  opponentProfileImageUrl: string | null;

  @ApiProperty({
    example: 0,
    description: 'debate 미구현으로 현재 placeholder',
  })
  debateTotalMinutes: number;

  static from(community: Community, host?: Member | null): CommunityDto {
    return {
      communityId: community.id,
      state: community.state,
      topic: community.topic,
      memberCount: community.memberCount,
      hostProfileImageUrl: host?.profileImageUrl ?? null,
      // TODO: debate 구현 후 상대방 프로필 채우기
      opponentProfileImageUrl: null,
      // TODO: debate 엔티티 논의 후 실제 총 진행시간 계산
      debateTotalMinutes: 0,
    };
  }
}

export class CommunitySliceDto {
  @ApiProperty({ example: 42 })
  totalCommunityCount: number;

  @ApiProperty({ type: [CommunityDto] })
  communityPreviews: CommunityDto[];

  @ApiProperty({ type: PageInfo })
  pageInfo: PageInfo;
}
