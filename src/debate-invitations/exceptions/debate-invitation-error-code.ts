import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/exceptions/app-error.interface';

// debate-invitations 도메인 에러 코드 카탈로그.
// 커뮤니티·회원·발언자 소속 에러는 소유 도메인의 카탈로그(CommunityErrorCode 등)를 그대로 쓴다.
export const DebateInvitationErrorCode = {
  NOT_FOUND: {
    httpStatus: HttpStatus.NOT_FOUND,
    code: 'DEBATE_INVITATION.NOT_FOUND',
    title: 'Debate Invitation Not Found',
    detail: '초대를 찾을 수 없습니다.',
  },
  HOST_ONLY: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE_INVITATION.HOST_ONLY',
    title: 'Host Only',
    detail: '방장만 토론을 시작할 수 있습니다.',
  },
  SELF_INVITATION: {
    httpStatus: HttpStatus.BAD_REQUEST,
    code: 'DEBATE_INVITATION.SELF_INVITATION',
    title: 'Self Invitation',
    detail: '자기 자신을 초대할 수 없습니다.',
  },
  HOST_NOT_OPEN_TO_DEBATE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_INVITATION.HOST_NOT_OPEN_TO_DEBATE',
    title: 'Host Not Open To Debate',
    detail: '토론 의사를 토론 가능으로 바꾼 뒤에 초대할 수 있습니다.',
  },
  OPPONENT_NOT_OPEN_TO_DEBATE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_INVITATION.OPPONENT_NOT_OPEN_TO_DEBATE',
    title: 'Opponent Not Open To Debate',
    detail: '상대가 아직 토론 준비 중입니다.',
  },
  ALREADY_PENDING: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_INVITATION.ALREADY_PENDING',
    title: 'Invitation Already Pending',
    detail: '이미 응답을 기다리는 초대가 있습니다.',
  },
  DEBATE_ALREADY_ACTIVE: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_INVITATION.DEBATE_ALREADY_ACTIVE',
    title: 'Debate Already Active',
    detail: '이미 진행 중인 토론이 있습니다.',
  },
  NOT_INVITEE: {
    httpStatus: HttpStatus.FORBIDDEN,
    code: 'DEBATE_INVITATION.NOT_INVITEE',
    title: 'Not Invitee',
    detail: '초대받은 사람만 응답할 수 있습니다.',
  },
  ALREADY_RESPONDED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_INVITATION.ALREADY_RESPONDED',
    title: 'Invitation Already Responded',
    detail: '이미 응답한 초대입니다.',
  },
  EXPIRED: {
    httpStatus: HttpStatus.CONFLICT,
    code: 'DEBATE_INVITATION.EXPIRED',
    title: 'Invitation Expired',
    detail: '응답 시간이 지나 만료된 초대입니다.',
  },
} as const satisfies Record<string, AppError>;
