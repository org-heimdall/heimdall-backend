import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsString, MinLength, ValidateIf } from 'class-validator';
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
  //TODO: 추후에 @Matches() 를 통해 정규식 검증 정책 필요
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
  // undefined(미전달)만 검증을 건너뛰고 null은 검증한다. @IsOptional을 쓰면 null도 검증을 건너뛰어버린다
  // 그러면 null이 bcrypt.hash까지 도달하는 문제가 생기므로, @ValidateIf로 undefined일 때만 검증을 건너뛴다.
  @ValidateIf((dto: UpdateMemberDto) => dto.newPassword !== undefined)
  @IsString()
  @MinLength(8)
  @MaxByteLength(PASSWORD_MAX_BYTES)
  newPassword?: string;
}
