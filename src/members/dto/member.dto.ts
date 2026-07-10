import { CommunityMemberType } from '../../communities/communities.controller';
import { KeynoteDto } from '../../communities/dto/keynote.dto';
import { Member } from '../entities/member.entity';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 회원 정보 응답 DTO. password는 절대 포함하지 않는다.
 */
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
  memberId: string;
  profileImageUrl: string;
  nickName: string;
  rating: number;
  memberType: CommunityMemberType;
}

export class MemberProfileDto {
  memberPreviewDto: MemberPreviewDto;
  keynoteDto: KeynoteDto;
}
