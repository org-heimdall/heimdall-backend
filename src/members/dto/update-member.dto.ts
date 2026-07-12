import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CreateMemberDto } from './create-member.dto';
import { MaxByteLength } from '../../common/validators/max-byte-length.validator';
import { PASSWORD_MAX_BYTES } from './password.constant';

/**
 * email은 unique 제약이 걸려 있어 별도의 이메일 변경 API에서 다룬다.
 * password는 현재 비밀번호 확인이 필요하므로 currentPassword/newPassword 쌍으로 받는다.
 */
export class UpdateMemberDto extends PartialType(
  OmitType(CreateMemberDto, ['email', 'password'] as const),
) {
  @ApiPropertyOptional({
    example: 'password1234',
    description: 'newPassword를 보낼 때만 필수',
  })
  @ValidateIf((dto: UpdateMemberDto) => dto.newPassword !== undefined)
  @IsString()
  @MinLength(1)
  @MaxByteLength(PASSWORD_MAX_BYTES)
  currentPassword?: string;

  @ApiPropertyOptional({
    example: 'newPassword1234',
    minLength: 8,
    description: `비밀번호는 최대 ${PASSWORD_MAX_BYTES}바이트`,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxByteLength(PASSWORD_MAX_BYTES)
  newPassword?: string;
}
