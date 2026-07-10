import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginMemberDto {
  @ApiProperty({ example: 'heimdall@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password1234' })
  @IsString()
  @MinLength(1)
  password: string;
}
