import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { WsServerEvent, sendEvent, wsEvent } from '../common/ws/ws-event';
import { WsRooms } from '../common/ws/ws-rooms';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';
import {
  DebateChatEvent,
  DebateChatTurn,
  DebateEndedPayload,
  DraftMessage,
  ProcessingStagePayload,
  TurnMessageCreatedPayload,
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

  // 발언은 재전송·재접속으로 다시 나갈 수 있어 id를 메시지 id에서 파생한다.
  messageCreatedEvent(
    debateId: string,
    message: DraftMessage,
  ): WsServerEvent<TurnMessageCreatedPayload> {
    return wsEvent(
      DebateChatEvent.TURN_MESSAGE_CREATED,
      { debateId, message },
      [message.id],
    );
  }

  // 같은 debate room, 송신자(소켓) 제외. HTTP로 들어온 발언은 제외할 소켓이 없어 sender를 생략한다.
  messageCreated(
    debateId: string,
    message: DraftMessage,
    sender?: WebSocket,
  ): void {
    this.rooms.broadcast(
      debateId,
      this.messageCreatedEvent(debateId, message),
      sender,
    );
  }

  // debate room 전체. 턴은 한 번만 확정되므로 턴 id가 곧 이벤트 identity다.
  turnFinalized(debateId: string, turn: DebateChatTurn): void {
    this.rooms.broadcast(
      debateId,
      wsEvent(DebateChatEvent.TURN_FINALIZED, { debateId, turn }, [turn.id]),
    );
  }

  // debate room 전체. 같은 단계라도 재시도마다 다른 사실이라 attempt까지 identity에 넣는다.
  processingStage(payload: ProcessingStagePayload): void {
    this.rooms.broadcast(
      payload.debateId,
      wsEvent(DebateChatEvent.PROCESSING_STAGE, payload, [
        payload.debateId,
        payload.stage,
        payload.status,
        payload.attempt,
      ]),
    );
  }

  // 계약상 debate room과 community room 양쪽에 간다 — 토론에 접속하지 않은 커뮤니티 화면도
  // 종료를 알아야 하므로, 토론 방에 보낸 payload 그대로 커뮤니티 발행자에게 넘긴다.
  debateEnded(payload: DebateEndedPayload): void {
    this.rooms.broadcast(
      payload.debateId,
      wsEvent(DebateChatEvent.DEBATE_ENDED, payload, [
        payload.debateId,
        payload.status,
      ]),
    );
    this.communityPublisher.debateEnded(payload);
  }
}
