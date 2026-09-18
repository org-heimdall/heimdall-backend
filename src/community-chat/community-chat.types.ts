// 계약 이벤트·payload와 1:1. 값을 바꾸면 프론트 mapper가 깨진다.

import { WsErrorPayload } from '../common/ws/ws-exception.filter';
import { CommunityMemberDto } from '../communities/dto/community-member.dto';
import { CommunityMessageDto } from '../communities/dto/community-message.dto';
import { CommunityOpinionDto } from '../communities/dto/community-opinion.dto';
// 토론 종료 이벤트는 토론 채팅이 발행하고 커뮤니티 방에도 간다. payload 정의는 소유 도메인(debate-chat) 것을 그대로 쓴다.
import type { DebateEndedPayload } from '../debate-chat/debate-chat.types';

export type { DebateEndedPayload };

// 클라이언트 → 서버 명령 이름.
export const CommunityChatCommand = {
  MESSAGE_SEND: 'message.send',
  OPINION_SUBMIT: 'opinion.submit',
} as const;

// 서버 → 클라이언트 이벤트 이름.
export const CommunityChatEvent = {
  MESSAGE_CREATED: 'message.created',
  MESSAGE_ACK: 'community.message.ack',
  OPINION_SUBMITTED: 'opinion.submitted',
  OPINION_ACK: 'community.opinion.ack',
  MEMBER_DEBATE_INTENT_CHANGED: 'community.member.debate-intent.changed',
  DEBATE_REQUESTED: 'debate.requested',
  DEBATE_REQUEST_REJECTED: 'debate.request.rejected',
  DEBATE_REQUEST_EXPIRED: 'debate.request.expired',
  DEBATE_STARTED: 'debate.started',
  DEBATE_ENDED: 'debate.ended',
  ERROR: 'error',
} as const;

// 메시지 저장 결과. 같은 clientMessageId 재전송이면 DUPLICATE다.
export type CommunityMessageAckStatus = 'STORED' | 'DUPLICATE';

// 의견 제출은 항상 저장된다(중복 판정이 없다). 계약이 status를 요구해 상수로 싣는다.
export const OPINION_ACK_STATUS = 'STORED';

export interface MessageCreatedPayload {
  communityId: string;
  message: CommunityMessageDto;
}

export interface MessageAckPayload {
  communityId: string;
  commandId: string;
  clientMessageId: string;
  status: CommunityMessageAckStatus;
  message: CommunityMessageDto;
}

export interface OpinionSubmittedPayload {
  communityId: string;
  opinion: CommunityOpinionDto;
}

export interface OpinionAckPayload {
  communityId: string;
  commandId: string;
  status: typeof OPINION_ACK_STATUS;
  opinion: CommunityOpinionDto;
}

export interface CommunityChatErrorPayload extends WsErrorPayload {
  communityId?: string;
}

// 아래는 커뮤니티 토론 초대 API(debate-invitations)가 발행하는 이벤트의 payload다.

export interface MemberDebateIntentChangedPayload {
  communityId: string;
  // 계약의 CommunityMember. REST 응답과 같은 DTO를 그대로 싣는다(모양이 갈라지지 않게).
  member: CommunityMemberDto;
}

// 계약의 DebateInvitation.
export interface DebateInvitationPayload {
  id: string;
  communityId: string;
  hostMemberId: string;
  hostName: string;
  opponentMemberId: string;
  expiresAt: string;
}

export interface DebateRequestedPayload {
  communityId: string;
  invitation: DebateInvitationPayload;
}

export interface DebateRequestRejectedPayload {
  communityId: string;
  invitationId: string;
  opponentMemberId: string;
}

export interface DebateRequestExpiredPayload {
  communityId: string;
  invitationId: string;
}

// 계약의 debate.started payload. 발언자 모양은 REST의 DebateSpeakerDto와 같은 것을 쓴다.
export interface DebateStartedPayload {
  communityId: string;
  debateId: string;
  sideASpeaker: DebateSpeakerPayload;
  sideBSpeaker: DebateSpeakerPayload;
  startedAt: string;
  expiresAt: string | null;
}

export interface DebateSpeakerPayload {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  score: number;
  claim: string;
  reasons: string[];
}
