import { CommunityMemberType } from '../../communities/communities.enums';
import { KeynoteDto } from '../../communities/dto/keynote.dto';
import { Member } from '../entities/member.entity';
import { ApiProperty } from '@nestjs/swagger';

// 계약의 Member. 엔티티 컬럼명(nickname/rating)은 그대로 두고 계약 이름으로만 바꿔 내보낸다.
export class MemberDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  id: string;

  @ApiProperty({
    example: 'heimdall@example.com',
    nullable: true,
    description: '프로필만 가진 회원(POST /members)은 null이다.',
  })
  email: string | null;

  @ApiProperty({ example: '헤임달' })
  displayName: string;

  @ApiProperty({ example: 'MALE', nullable: true })
  gender: string | null;

  @ApiProperty({ example: 28, nullable: true })
  age: number | null;

  @ApiProperty({
    example: 'https://cdn.example.com/profile/1.png',
    nullable: true,
  })
  profileImageUrl: string | null;

  @ApiProperty({ example: 0 })
  socialCredit: number;

  @ApiProperty({ example: 0, description: '토론 전적 점수(엔티티의 rating)' })
  score: number;

  @ApiProperty({ example: '2026-09-07T11:59:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-09-07T11:59:00.000Z' })
  updatedAt: string;

  static from(member: Member): MemberDto {
    return {
      id: member.id,
      email: member.email,
      displayName: member.nickname,
      gender: member.gender,
      age: member.age,
      profileImageUrl: member.profileImageUrl,
      socialCredit: member.socialCredit,
      score: member.rating,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  }
}

export class MemberPreviewDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  memberId: string;

  @ApiProperty({
    example: 'https://cdn.example.com/profile/1.png',
    nullable: true,
  })
  profileImageUrl: string | null;

  @ApiProperty({ example: '헤임달' })
  nickName: string;

  @ApiProperty({ example: 0 })
  rating: number;

  @ApiProperty({ enum: CommunityMemberType, example: CommunityMemberType.HOST })
  memberType: CommunityMemberType;

  static from(
    member: Member,
    memberType: CommunityMemberType,
  ): MemberPreviewDto {
    return {
      memberId: member.id,
      profileImageUrl: member.profileImageUrl,
      nickName: member.nickname,
      rating: member.rating,
      memberType,
    };
  }
}

export class MemberProfileDto {
  memberPreviewDto: MemberPreviewDto;
  keynoteDto: KeynoteDto;
}
