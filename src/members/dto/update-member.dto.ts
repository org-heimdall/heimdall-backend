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

// 계약상 수정 경로의 표시 이름 한도는 가입(20자)보다 넓다.
export const UPDATE_DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * email은 unique 제약이 걸려 있어 별도의 이메일 변경 API에서 다룬다.
 * password는 현재 비밀번호 확인이 필요하므로 currentPassword/newPassword 쌍으로 받는다.
 */
export class UpdateMemberDto extends PartialType(
  OmitType(CreateMemberDto, ['email', 'password', 'displayName'] as const),
) {
  /**
   * displayName은 한도가 가입(20자)과 달라 상속하지 않고 여기서 새로 정의한다.
   * 상속한 뒤 덮어쓰면 부모의 제약이 함께 살아남을 수 있어 실제 한도가 20자로 굳는다.
   */
  @ApiPropertyOptional({
    example: '새로운헤임달',
    maxLength: UPDATE_DISPLAY_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(UPDATE_DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

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
  //TODO: 추후에 @Matches() 를 통해 정규식 검증 정책 필요
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
