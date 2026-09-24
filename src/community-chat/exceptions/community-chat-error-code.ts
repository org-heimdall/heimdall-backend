import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// community-chat 도메인 에러 코드 카탈로그. WS error 이벤트의 code/message는 여기서 파생된다.
// 커뮤니티 없음은 CommunityErrorCode.NOT_FOUND, 인증 실패는 AuthErrorCode,
// 입력 형식 오류는 ErrorCode.INVALID_INPUT을 재사용한다.
export const CommunityChatErrorCode = {
  NOT_PARTICIPANT: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'COMMUNITY_CHAT.NOT_PARTICIPANT',
    title: 'Not A Participant',
    detail: '커뮤니티 참여자만 메시지를 보낼 수 있습니다.',
  },
  OPINION_REQUIRED: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'COMMUNITY_CHAT.OPINION_REQUIRED',
    title: 'Opinion Required',
    detail: '기조 발언을 작성한 참여자만 메시지를 보낼 수 있습니다.',
  },
} as const satisfies Record<string, AppError>;
