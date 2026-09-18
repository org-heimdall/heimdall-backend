import { ApiProperty } from '@nestjs/swagger';
import { MemberDto } from '../../members/dto/member.dto';
import { IssuedToken } from '../token.service';

export class AuthTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;

  @ApiProperty({
    example: 1800,
    description: 'accessToken 만료까지 남은 초',
  })
  expiresIn: number;

  @ApiProperty({ type: MemberDto })
  member: MemberDto;

  static of(
    access: IssuedToken,
    refresh: IssuedToken,
    member: MemberDto,
  ): AuthTokenDto {
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: Math.max(
        0,
        Math.floor((access.expiresAt.getTime() - Date.now()) / 1000),
      ),
      member,
    };
  }
}
