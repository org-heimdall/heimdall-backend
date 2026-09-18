import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MaxByteLength } from '../../common/validators/max-byte-length.validator';
import { PASSWORD_MAX_BYTES } from './password.constant';

export const DISPLAY_NAME_MAX_LENGTH = 20;
export const PROFILE_IMAGE_URL_MAX_LENGTH = 1000;

export class CreateMemberDto {
  @ApiProperty({ example: 'heimdall@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email: string;
  //TODO: 추후에 @Matches() 를 통해 정규식 검증 정책 필요
  @ApiProperty({
    example: 'password1234',
    minLength: 8,
    description: `비밀번호는 최대 ${PASSWORD_MAX_BYTES}바이트`,
  })
  @IsString()
  @MinLength(8)
  @MaxByteLength(PASSWORD_MAX_BYTES)
  password: string;

  @ApiProperty({ example: '헤임달', maxLength: DISPLAY_NAME_MAX_LENGTH })
  @IsString()
  @MinLength(2)
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName: string;

  @ApiPropertyOptional({ example: 'MALE' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string | null;

  @ApiPropertyOptional({ example: 28 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number | null;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/profile/1.png',
    maxLength: PROFILE_IMAGE_URL_MAX_LENGTH,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(PROFILE_IMAGE_URL_MAX_LENGTH)
  profileImageUrl?: string | null;
}
