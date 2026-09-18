import { PickType } from '@nestjs/swagger';
import { CreateMemberDto } from './create-member.dto';

/**
 * 자격증명 없이 표시 이름·프로필 사진만으로 회원을 만드는 요청(POST /members).
 * 검증 규칙은 가입 DTO에서 그대로 물려받아 두 경로의 제한이 갈라지지 않게 한다.
 */
export class CreateMemberProfileDto extends PickType(CreateMemberDto, [
  'displayName',
  'profileImageUrl',
] as const) {}
