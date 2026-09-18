import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// auth 도메인 에러 코드 카탈로그.
// 사용 예: throw new GeneralException(AuthErrorCode.TOKEN_EXPIRED);
export const AuthErrorCode = {
  UNAUTHORIZED: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'AUTH.UNAUTHORIZED',
    title: 'Unauthorized',
    detail: '인증이 필요합니다.',
  },
  INVALID_TOKEN: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'AUTH.INVALID_TOKEN',
    title: 'Invalid Token',
    detail: '유효하지 않은 토큰입니다.',
  },
  TOKEN_EXPIRED: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'AUTH.TOKEN_EXPIRED',
    title: 'Token Expired',
    detail: '토큰이 만료되었습니다.',
  },
  INVALID_REFRESH_TOKEN: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'AUTH.INVALID_REFRESH_TOKEN',
    title: 'Invalid Refresh Token',
    detail: '유효하지 않은 리프레시 토큰입니다.',
  },
  OAUTH_VERIFICATION_FAILED: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'AUTH.OAUTH_VERIFICATION_FAILED',
    title: 'OAuth Verification Failed',
    detail: '소셜 로그인 인증에 실패했습니다.',
  },
  UNSUPPORTED_PROVIDER: {
    httpStatus: HttpStatus.BAD_REQUEST,
    code: 'AUTH.UNSUPPORTED_PROVIDER',
    title: 'Unsupported Provider',
    detail: '지원하지 않는 소셜 로그인입니다.',
  },
  EMAIL_ALREADY_EXISTS: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'AUTH.EMAIL_ALREADY_EXISTS',
    title: 'Email Already Exists',
    detail: '이미 다른 방식으로 가입된 이메일입니다.',
  },
} as const satisfies Record<string, AppError>;
