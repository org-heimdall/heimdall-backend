import { ApiProperty } from '@nestjs/swagger';
import {
  CommunityDebateIntent,
  MemberCommunity,
} from '../../member-communities/entities/member-community.entity';
import { Member } from '../../members/entities/member.entity';

// 계약의 CommunityMemberRole. 커뮤니티 안에서의 역할이라 회원 자체의 속성이 아니다.
export enum CommunityMemberRole {
  HOST = 'HOST',
  MEMBER = 'MEMBER',
}

// 계약의 CommunityMember. 회원 정보(member) + 그 커뮤니티에서의 참여 정보(member_community)를 합친다.
export class CommunityMemberDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({ example: '헤임달' })
  displayName: string;

  @ApiProperty({
    example: 'https://cdn.example.com/profile/1.png',
    nullable: true,
  })
  profileImageUrl: string | null;

  @ApiProperty({ enum: CommunityMemberRole, example: CommunityMemberRole.HOST })
  role: CommunityMemberRole;

  @ApiProperty({
    enum: CommunityDebateIntent,
    example: CommunityDebateIntent.OPEN_TO_DEBATE,
  })
  debateIntent: CommunityDebateIntent;

  @ApiProperty({ example: '2026-09-07T11:59:00.000Z' })
  joinedAt: string;

  static from(
    member: Member,
    participation: MemberCommunity,
    hostId: string,
  ): CommunityMemberDto {
    return Object.assign(new CommunityMemberDto(), {
      id: member.id,
      displayName: member.nickname,
      profileImageUrl: member.profileImageUrl,
      role:
        participation.memberId === hostId
          ? CommunityMemberRole.HOST
          : CommunityMemberRole.MEMBER,
      debateIntent: participation.debateIntent,
      joinedAt: participation.createdAt.toISOString(),
    });
  }
}
