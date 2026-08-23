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
  NOT_COMMUNITY_MEMBER: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE.NOT_COMMUNITY_MEMBER',
    title: 'Not Community Member',
    detail: '해당 커뮤니티에 참여한 회원만 이용할 수 있습니다.',
  },
  INVALID_PHASE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.INVALID_PHASE',
    title: 'Invalid Phase',
    detail: '지금은 발언할 수 있는 단계가 아닙니다.',
  },
  MESSAGE_BUDGET_EXCEEDED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.MESSAGE_BUDGET_EXCEEDED',
    title: 'Message Budget Exceeded',
    detail: '이번 턴에 발언할 수 있는 글자 수를 초과했습니다.',
  },
  NOT_HOST: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE.NOT_HOST',
    title: 'Not Host',
    detail: '커뮤니티 호스트만 토론을 생성할 수 있습니다.',
  },
  OPPONENT_NOT_IN_COMMUNITY: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.OPPONENT_NOT_IN_COMMUNITY',
    title: 'Opponent Not In Community',
    detail: '상대 토론자가 커뮤니티에 참여하고 있지 않습니다.',
  },
  OPPONENT_KEYNOTE_REQUIRED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.OPPONENT_KEYNOTE_REQUIRED',
    title: 'Opponent Keynote Required',
    detail: '기조발언을 작성한 참여자에게만 토론을 요청할 수 있습니다.',
  },
  REQUEST_NOT_PENDING: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.REQUEST_NOT_PENDING',
    title: 'Request Not Pending',
    detail: '이미 처리된 토론 요청입니다.',
  },
  NOT_REQUEST_OPPONENT: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE.NOT_REQUEST_OPPONENT',
    title: 'Not Request Opponent',
    detail: '토론 요청을 받은 당사자만 응답할 수 있습니다.',
  },
  REQUEST_NOT_ACCEPTED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.REQUEST_NOT_ACCEPTED',
    title: 'Request Not Accepted',
    detail: '아직 수락되지 않은 토론입니다.',
  },
  DEBATE_ALREADY_ACTIVE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE.DEBATE_ALREADY_ACTIVE',
    title: 'Debate Already Active',
    detail: '이 커뮤니티에 이미 진행 중인 토론이 있습니다.',
  },
} as const satisfies Record<string, AppError>;
