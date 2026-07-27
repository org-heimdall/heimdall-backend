import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// members 도메인 에러 코드 카탈로그.
// 사용 예: throw new GeneralException(MemberErrorCode.NOT_FOUND);
export const MemberErrorCode = {
  NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'MEMBER.NOT_FOUND',
    title: 'Member Not Found',
    detail: '회원을 찾을 수 없습니다.',
  },
  EMAIL_ALREADY_EXISTS: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'MEMBER.EMAIL_ALREADY_EXISTS',
    title: 'Email Already Exists',
    detail: '이미 가입된 이메일입니다.',
  },
  INVALID_CREDENTIALS: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'MEMBER.INVALID_CREDENTIALS',
    title: 'Invalid Credentials',
    detail: '이메일 또는 비밀번호가 올바르지 않습니다.',
  },
  INVALID_CURRENT_PASSWORD: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'MEMBER.INVALID_CURRENT_PASSWORD',
    title: 'Invalid Current Password',
    detail: '현재 비밀번호가 올바르지 않습니다.',
  },
  SOCIAL_ACCOUNT_NO_PASSWORD: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'MEMBER.SOCIAL_ACCOUNT_NO_PASSWORD',
    title: 'Social Account Has No Password',
    detail: '소셜 로그인 계정은 비밀번호를 사용할 수 없습니다.',
  },
} as const satisfies Record<string, AppError>;
