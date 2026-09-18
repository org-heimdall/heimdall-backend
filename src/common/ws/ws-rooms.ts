import { WebSocket } from 'ws';
import { sendEvent, WsServerEvent } from './ws-event';

/**
 * 방(roomId → 소켓 집합) 레지스트리와 방 대상 브로드캐스트.
 * 토론 채팅(debateId)과 커뮤니티 채팅(communityId)이 같은 구조를 쓰므로 여기로 내렸다.
 * 방은 프로세스 로컬이며 다중 인스턴스 fan-out은 운영 확장 과제다.
 */
export class WsRooms {
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly roomOf = new Map<WebSocket, string>();

  join(roomId: string, socket: WebSocket): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
    }
    room.add(socket);
    this.roomOf.set(socket, roomId);
  }

  leave(socket: WebSocket): void {
    const roomId = this.roomOf.get(socket);
    if (roomId === undefined) {
      return;
    }
    this.roomOf.delete(socket);
    const room = this.rooms.get(roomId);
    room?.delete(socket);
    if (room?.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  size(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  // 방 전체에 보낸다. except를 주면 그 소켓만 건너뛴다(송신자 제외 브로드캐스트).
  broadcast<T>(
    roomId: string,
    event: WsServerEvent<T>,
    except?: WebSocket,
  ): void {
    for (const socket of this.rooms.get(roomId) ?? []) {
      if (socket !== except) {
        sendEvent(socket, event);
      }
    }
  }
}
