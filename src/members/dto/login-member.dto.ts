import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { MaxByteLength } from '../../common/validators/max-byte-length.validator';
import { PASSWORD_MAX_BYTES } from './password.constant';

export class LoginMemberDto {
  @ApiProperty({ example: 'heimdall@example.com' })
  @IsEmail()
  email: string;
  //TODO: 추후에 @Matches() 를 통해 정규식 검증 정책 필요
  @ApiProperty({ example: 'password1234' })
  @IsString()
  @MinLength(1)
  @MaxByteLength(PASSWORD_MAX_BYTES)
  password: string;
}
