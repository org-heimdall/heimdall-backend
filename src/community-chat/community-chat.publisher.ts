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

  join(communityId: string, socket: WebSocket): void {
    this.rooms.join(communityId, socket);
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

  /**
   * 아래는 아직 호출처가 없다. 초대 API(POST …/debates/start·accept·reject)와
   * debate-intent API가 들어오면서 발행처가 붙는다(전송 계층만 먼저 맞춰 둔다).
   */

  memberDebateIntentChanged(payload: MemberDebateIntentChangedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.MEMBER_DEBATE_INTENT_CHANGED,
      payload,
    });
  }

  debateRequested(payload: DebateRequestedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.DEBATE_REQUESTED,
      payload,
    });
  }

  debateRequestRejected(payload: DebateRequestRejectedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.DEBATE_REQUEST_REJECTED,
      payload,
    });
  }

  debateRequestExpired(payload: DebateRequestExpiredPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.DEBATE_REQUEST_EXPIRED,
      payload,
    });
  }

  debateStarted(payload: DebateStartedPayload): void {
    this.rooms.broadcast(payload.communityId, {
      type: CommunityChatEvent.DEBATE_STARTED,
      payload,
    });
  }
}
