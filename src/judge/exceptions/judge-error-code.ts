import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

/**
 * 판정 파이프라인 에러 카탈로그.
 * 토론을 찾지 못하는 경우는 DebateErrorCode.NOT_FOUND를 재사용한다.
 */
export const JudgeErrorCode = {
  NOT_FINALIZED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.NOT_FINALIZED',
    title: 'Debate Not Finalized',
    detail: '아직 끝나지 않은 토론은 판정할 수 없습니다.',
  },
  IN_PROGRESS: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.IN_PROGRESS',
    title: 'Judgment In Progress',
    detail: '판정이 진행 중입니다. 잠시 후 다시 확인해 주세요.',
  },
  ALREADY_COMPLETED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.ALREADY_COMPLETED',
    title: 'Judgment Already Completed',
    detail: '이미 판정이 끝난 토론입니다.',
  },
  PROCESSING_FAILED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.PROCESSING_FAILED',
    title: 'Processing Failed',
    detail: '판정에 필요한 처리가 실패했습니다. 재시도해 주세요.',
  },
  RETRY_NOT_READY: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.RETRY_NOT_READY',
    title: 'Retry Not Ready',
    detail: '재시도까지 잠시 기다려 주세요.',
  },
  NOTHING_TO_RETRY: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.NOTHING_TO_RETRY',
    title: 'Nothing To Retry',
    detail: '재시도할 실패한 작업이 없습니다.',
  },
  RESULT_NOT_READY: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'JUDGE.RESULT_NOT_READY',
    title: 'Result Not Ready',
    detail: '아직 판정 결과가 없습니다.',
  },
} as const satisfies Record<string, AppError>;
