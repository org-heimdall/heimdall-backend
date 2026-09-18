import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberCommunity } from '../../member-communities/entities/member-community.entity';
import { Member } from '../../members/entities/member.entity';

// 의견이 이번 요청으로 새로 생겼는지 수정됐는지. 계약상 선택 필드라 replay에는 싣지 않는다.
export enum CommunityOpinionAction {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
}

// 계약의 CommunityOpinion. 기조 발언은 member_community 행에 있으므로 그 행을 그대로 옮긴다.
export class CommunityOpinionDto {
  @ApiProperty({ example: '9a5f9f5e-1f5a-4f1e-9a1d-6f2a3b4c5d6e' })
  id: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  communityId: string;

  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  authorId: string;

  @ApiProperty({ example: '헤임달' })
  authorName: string;

  @ApiProperty({ example: '인공지능 규제는 강화되어야 한다.' })
  claim: string;

  @ApiProperty({
    example: ['안전성 확보', '책임 소재 명확화'],
    type: [String],
  })
  reasons: string[];

  @ApiProperty({ example: '2026-09-18T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-09-18T12:00:00.000Z' })
  updatedAt: string;

  @ApiPropertyOptional({ enum: CommunityOpinionAction })
  action?: CommunityOpinionAction;

  // opinion이 있는 행만 의견이다(findOpinions/updateKeynote가 그것을 보장한다).
  static from(
    row: MemberCommunity,
    author: Member,
    action?: CommunityOpinionAction,
  ): CommunityOpinionDto {
    return {
      id: row.id,
      communityId: row.communityId,
      authorId: row.memberId,
      authorName: author.nickname,
      claim: row.opinion ?? '',
      reasons: row.reasons ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(action ? { action } : {}),
    };
  }
}
