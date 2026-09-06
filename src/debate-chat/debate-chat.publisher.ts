import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import {
  DebateChatEvent,
  DebateChatTurn,
  DebateEndedPayload,
  DraftMessage,
  ProcessingStagePayload,
  WsServerEvent,
} from './debate-chat.types';

// 닫힌 소켓에 보내면 ws가 throw하므로 열린 경우에만 보낸다(브로드캐스트 중 끊긴 소켓 방어).
export function sendEvent<T>(socket: WebSocket, event: WsServerEvent<T>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

/**
 * debate room(debateId → 소켓 집합)과 방 대상 이벤트 발행. 전달 범위는 backend-internal-design의
 * broadcast 표를 따른다. 방은 프로세스 로컬이며 다중 인스턴스 fan-out은 운영 확장 과제다.
 */
@Injectable()
export class DebateChatPublisher {
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly roomOf = new Map<WebSocket, string>();

  join(debateId: string, socket: WebSocket): void {
    let room = this.rooms.get(debateId);
    if (!room) {
      room = new Set();
      this.rooms.set(debateId, room);
    }
    room.add(socket);
    this.roomOf.set(socket, debateId);
  }

  leave(socket: WebSocket): void {
    const debateId = this.roomOf.get(socket);
    if (debateId === undefined) {
      return;
    }
    this.roomOf.delete(socket);
    const room = this.rooms.get(debateId);
    room?.delete(socket);
    if (room?.size === 0) {
      this.rooms.delete(debateId);
    }
  }

  size(debateId: string): number {
    return this.rooms.get(debateId)?.size ?? 0;
  }

  // 같은 debate room, 송신자(소켓) 제외. HTTP로 들어온 발언은 제외할 소켓이 없어 sender를 생략한다.
  messageCreated(
    debateId: string,
    message: DraftMessage,
    sender?: WebSocket,
  ): void {
    this.broadcast(
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
    this.broadcast(debateId, {
      type: DebateChatEvent.TURN_FINALIZED,
      payload: { debateId, turn },
    });
  }

  // debate room 전체.
  processingStage(payload: ProcessingStagePayload): void {
    this.broadcast(payload.debateId, {
      type: DebateChatEvent.PROCESSING_STAGE,
      payload,
    });
  }

  // debate room 전체. 계약상 community room에도 보내야 하며, 커뮤니티 채팅 구현 시 여기서 함께 호출한다.
  debateEnded(payload: DebateEndedPayload): void {
    this.broadcast(payload.debateId, {
      type: DebateChatEvent.DEBATE_ENDED,
      payload,
    });
  }

  private broadcast<T>(
    debateId: string,
    event: WsServerEvent<T>,
    except?: WebSocket,
  ): void {
    for (const socket of this.rooms.get(debateId) ?? []) {
      if (socket !== except) {
        sendEvent(socket, event);
      }
    }
  }
}
