import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { sendEvent } from '../common/ws/ws-event';
import { WsRooms } from '../common/ws/ws-rooms';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';
import {
  DebateChatEvent,
  DebateChatTurn,
  DebateEndedPayload,
  DraftMessage,
  ProcessingStagePayload,
} from './debate-chat.types';

export { sendEvent };

/**
 * debate room(debateId → 소켓 집합)과 방 대상 이벤트 발행. 전달 범위는 backend-internal-design의
 * broadcast 표를 따른다. 방 레지스트리는 공통 WsRooms를 합성해서 쓴다.
 */
@Injectable()
export class DebateChatPublisher {
  private readonly rooms = new WsRooms();

  constructor(private readonly communityPublisher: CommunityChatPublisher) {}

  join(debateId: string, socket: WebSocket): void {
    this.rooms.join(debateId, socket);
  }

  leave(socket: WebSocket): void {
    this.rooms.leave(socket);
  }

  size(debateId: string): number {
    return this.rooms.size(debateId);
  }

  // 같은 debate room, 송신자(소켓) 제외. HTTP로 들어온 발언은 제외할 소켓이 없어 sender를 생략한다.
  messageCreated(
    debateId: string,
    message: DraftMessage,
    sender?: WebSocket,
  ): void {
    this.rooms.broadcast(
      debateId,
      {
        type: DebateChatEvent.TURN_MESSAGE_CREATED,
        payload: { debateId, message },
      },
      sender,
    );
  }

  // debate room 전체.
  turnFinalized(debateId: string, turn: DebateChatTurn): void {
    this.rooms.broadcast(debateId, {
      type: DebateChatEvent.TURN_FINALIZED,
      payload: { debateId, turn },
    });
  }

  // debate room 전체.
  processingStage(payload: ProcessingStagePayload): void {
    this.rooms.broadcast(payload.debateId, {
      type: DebateChatEvent.PROCESSING_STAGE,
      payload,
    });
  }

  // 계약상 debate room과 community room 양쪽에 간다 — 토론에 접속하지 않은 커뮤니티 화면도
  // 종료를 알아야 하므로, 토론 방에 보낸 payload 그대로 커뮤니티 발행자에게 넘긴다.
  debateEnded(payload: DebateEndedPayload): void {
    this.rooms.broadcast(payload.debateId, {
      type: DebateChatEvent.DEBATE_ENDED,
      payload,
    });
    this.communityPublisher.debateEnded(payload);
  }
}
