import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// debate-chat 도메인 에러 코드 카탈로그. WS error 이벤트의 code/message는 여기서 파생된다.
// 토론 없음은 DebateErrorCode.NOT_FOUND, 인증 실패는 AuthErrorCode, 입력 형식 오류는 ErrorCode.INVALID_INPUT을 재사용한다.
export const DebateChatErrorCode = {
  NOT_PARTICIPANT: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE_CHAT.NOT_PARTICIPANT',
    title: 'Not A Participant',
    detail: '토론 참가자만 발언할 수 있습니다.',
  },
  SPEAKER_MISMATCH: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE_CHAT.SPEAKER_MISMATCH',
    title: 'Speaker Mismatch',
    detail: '발언자 정보가 현재 사용자와 일치하지 않습니다.',
  },
  OPPONENT_MISSING: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_CHAT.OPPONENT_MISSING',
    title: 'Opponent Missing',
    detail: '상대 발언자가 없어 토론을 시작할 수 없습니다.',
  },
  NOT_IN_PROGRESS: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_CHAT.NOT_IN_PROGRESS',
    title: 'Debate Not In Progress',
    detail: '진행 중인 토론이 아닙니다.',
  },
  TURN_MISMATCH: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_CHAT.TURN_MISMATCH',
    title: 'Turn Mismatch',
    detail: '현재 발언 차례가 아닙니다.',
  },
  CONTENT_TOO_LONG: {
    httpStatus: HttpStatus.BAD_REQUEST,
    code: 'DEBATE_CHAT.CONTENT_TOO_LONG',
    title: 'Content Too Long',
    detail: '메시지 길이가 허용 범위를 넘었습니다.',
  },
  TURN_CHARACTER_LIMIT_EXCEEDED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_CHAT.TURN_CHARACTER_LIMIT_EXCEEDED',
    title: 'Turn Character Limit Exceeded',
    detail: '이번 차례에 쓸 수 있는 글자 수를 모두 사용했습니다.',
  },
  FINALIZE_IN_PROGRESS: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_CHAT.FINALIZE_IN_PROGRESS',
    title: 'Finalize In Progress',
    detail: '다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
  },
  TURN_EMPTY: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_CHAT.TURN_EMPTY',
    title: 'Turn Empty',
    detail: '발언 내용이 없어 차례를 마칠 수 없습니다.',
  },
} as const satisfies Record<string, AppError>;
