import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// judge 도메인 에러 코드 카탈로그.
// 토론을 찾지 못하는 경우는 DebateErrorCode.NOT_FOUND를 재사용한다.
export const JudgeErrorCode = {
  ALREADY_REQUESTED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.ALREADY_REQUESTED',
    title: 'Judgment Already Requested',
    detail: '이미 판정이 진행 중이거나 완료된 토론입니다.',
  },
  NOT_JUDGEABLE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.NOT_JUDGEABLE',
    title: 'Debate Not Judgeable',
    detail: '판정할 수 있는 상태의 토론이 아닙니다.',
  },
  NOT_REQUESTED: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'JUDGE.NOT_REQUESTED',
    title: 'Judgment Not Requested',
    detail: '아직 판정이 요청되지 않은 토론입니다.',
  },
  UNAVAILABLE: {
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    code: 'JUDGE.UNAVAILABLE',
    title: 'Judge Unavailable',
    detail: '판정 서비스를 일시적으로 사용할 수 없습니다.',
  },
} as const satisfies Record<string, AppError>;
