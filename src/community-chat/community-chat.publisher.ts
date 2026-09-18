import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { WsRooms } from '../common/ws/ws-rooms';
import { CommunityMessageDto } from '../communities/dto/community-message.dto';
import { CommunityOpinionDto } from '../communities/dto/community-opinion.dto';
import {
  CommunityChatEvent,
  DebateEndedPayload,
  DebateRequestedPayload,
  DebateRequestExpiredPayload,
  DebateRequestRejectedPayload,
  DebateStartedPayload,
  MemberDebateIntentChangedPayload,
} from './community-chat.types';

/**
 * community room(communityId → 소켓 집합)과 방 대상 이벤트 발행.
 * 요청 소켓 대상 응답(ack/error)은 소켓을 아는 게이트웨이가 직접 보낸다.
 */
@Injectable()
export class CommunityChatPublisher {
  private readonly rooms = new WsRooms();

  // memberId는 회원 단위 전송(초대 이벤트)에 쓴다. 관전자도 방에는 들어오므로 방 전체 전송과는 별개다.
  join(communityId: string, socket: WebSocket, memberId?: string): void {
    this.rooms.join(communityId, socket, memberId);
  }

  leave(socket: WebSocket): void {
    this.rooms.leave(socket);
  }

  size(communityId: string): number {
    return this.rooms.size(communityId);
  }

  // 같은 community room, 송신자(소켓) 제외 — 본인은 ack의 message로 받는다.
  // HTTP로 들어온 메시지는 제외할 소켓이 없어 sender를 생략한다.
  messageCreated(
    communityId: string,
    message: CommunityMessageDto,
    sender?: WebSocket,
  ): void {
    this.rooms.broadcast(
      communityId,
      {
        type: CommunityChatEvent.MESSAGE_CREATED,
        payload: { communityId, message },
      },
      sender,
    );
  }

  // 같은 community room, 송신자 제외. 본인은 ack의 opinion으로 받는다.
  opinionSubmitted(
    communityId: string,
    opinion: CommunityOpinionDto,
    sender?: WebSocket,
  ): void {
    this.rooms.broadcast(
      communityId,
      {
        type: CommunityChatEvent.OPINION_SUBMITTED,
        payload: { communityId, opinion },
      },
      sender,
    );
  }

  // 토론이 끝났음을 커뮤니티 화면에 알린다(DebateChatPublisher가 debate room과 함께 호출한다).
  debateEnded(payload: DebateEndedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.DEBATE_ENDED,
      payload,
    });
  }

  // 토론 의사 변경은 방 전체가 본다(참여자 목록이 바로 갱신돼야 한다).
  memberDebateIntentChanged(payload: MemberDebateIntentChangedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.MEMBER_DEBATE_INTENT_CHANGED,
      payload,
    });
  }

  // 초대받은 사람에게만. 방장은 REST 응답(DebateInvitation)으로 같은 내용을 받는다.
  debateRequested(payload: DebateRequestedPayload): void {
    this.rooms.sendToMember(
      payload.communityId,
      payload.invitation.opponentMemberId,
      { type: CommunityChatEvent.DEBATE_REQUESTED, payload },
    );
  }

  // 거절은 방장에게만. 거절한 본인은 REST 204로 결과를 안다.
  debateRequestRejected(
    payload: DebateRequestRejectedPayload,
    hostMemberId: string,
  ): void {
    this.rooms.sendToMember(payload.communityId, hostMemberId, {
      type: CommunityChatEvent.DEBATE_REQUEST_REJECTED,
      payload,
    });
  }

  // 만료는 대기 화면을 띄우고 있는 양쪽 모두에게 간다.
  debateRequestExpired(
    payload: DebateRequestExpiredPayload,
    hostMemberId: string,
    opponentMemberId: string,
  ): void {
    const event = {
      type: CommunityChatEvent.DEBATE_REQUEST_EXPIRED,
      payload,
    };
    for (const memberId of new Set([hostMemberId, opponentMemberId])) {
      this.rooms.sendToMember(payload.communityId, memberId, event);
    }
  }

  // 토론 시작은 방 전체가 본다 — 관전자도 토론 화면으로 따라 들어가야 하므로
  // 계약의 "양쪽"보다 넓게 보낸다(debate.ended가 방 전체인 것과 대칭).
  debateStarted(payload: DebateStartedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.DEBATE_STARTED,
      payload,
    });
  }
}
