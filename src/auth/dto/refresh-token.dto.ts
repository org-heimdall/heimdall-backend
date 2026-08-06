import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: '로그인 또는 직전 refresh에서 받은 리프레시 토큰',
  })
  @IsNotEmpty()
  @IsJWT()
  refreshToken: string;
}
