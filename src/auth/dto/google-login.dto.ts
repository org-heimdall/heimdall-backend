import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjBlNzJkYS...',
    description: 'Google Identity Services가 발급한 ID token',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
