import { HttpStatus } from '@nestjs/common';
import { AppError } from './app-error.interface';

// 도메인에 속하지 않는 공통 에러 코드 카탈로그.
// 도메인별 코드는 각 도메인 모듈의 exceptions/ 아래에 같은 형태로 정의한다.
export const ErrorCode = {
  INTERNAL_SERVER_ERROR: {
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'COMMON.INTERNAL_ERROR',
    title: 'Internal Server Error',
    detail: '서버 내부 오류가 발생했습니다.',
  },
  INVALID_INPUT: {
    httpStatus: HttpStatus.BAD_REQUEST,
    code: 'COMMON.INVALID_INPUT',
    title: 'Invalid Input',
    detail: '입력값이 올바르지 않습니다.',
  },
  UNAUTHORIZED: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    code: 'COMMON.UNAUTHORIZED',
    title: 'Unauthorized',
    detail: '인증이 필요합니다.',
  },
  FORBIDDEN: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'COMMON.FORBIDDEN',
    title: 'Forbidden',
    detail: '접근 권한이 없습니다.',
  },
  NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'COMMON.NOT_FOUND',
    title: 'Not Found',
    detail: '요청한 리소스를 찾을 수 없습니다.',
  },
  CONFLICT: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'COMMON.CONFLICT',
    title: 'Conflict',
    detail: '리소스 충돌이 발생했습니다.',
  },
} as const satisfies Record<string, AppError>;
