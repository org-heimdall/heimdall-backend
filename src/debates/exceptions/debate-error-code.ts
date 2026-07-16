import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// debates 도메인 에러 코드 카탈로그.
// 사용 예: throw new GeneralException(DebateErrorCode.NOT_YOUR_TURN);
export const DebateErrorCode = {
  NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'DEBATE.NOT_FOUND',
    title: 'Debate Not Found',
    detail: '토론방을 찾을 수 없습니다.',
  },
  ALREADY_JOINED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.ALREADY_JOINED',
    title: 'Already Joined',
    detail: '이미 참여한 토론방입니다.',
  },
  NOT_YOUR_TURN: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.NOT_YOUR_TURN',
    title: 'Not Your Turn',
    detail: '현재 발언할 차례가 아닙니다.',
  },
} as const satisfies Record<string, AppError>;
