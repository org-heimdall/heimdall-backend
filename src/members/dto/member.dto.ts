import { CommunityMemberType } from '../../communities/communities.enums';
import { KeynoteDto } from '../../communities/dto/keynote.dto';
import { Member } from '../entities/member.entity';
import { ApiProperty } from '@nestjs/swagger';

export class MemberDto {
  @ApiProperty({ example: '3f0c1b2e-9a1d-4c8e-8f3a-1b2c3d4e5f60' })
  memberId: string;

  @ApiProperty({ example: 'heimdall@example.com' })
  email: string;

  @ApiProperty({ example: '헤임달' })
  nickname: string;

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

  @ApiProperty({ example: 0 })
  rating: number;

  static from(member: Member): MemberDto {
    return {
      memberId: member.id,
      email: member.email,
      nickname: member.nickname,
      gender: member.gender,
      age: member.age,
      profileImageUrl: member.profileImageUrl,
      socialCredit: member.socialCredit,
      rating: member.rating,
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
