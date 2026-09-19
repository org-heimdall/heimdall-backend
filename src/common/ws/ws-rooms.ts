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
  private readonly memberOf = new Map<WebSocket, string>();

  // memberId를 주면 그 소켓이 누구의 것인지 함께 기억해, 회원 단위 전송(sendToMember)이 가능해진다.
  join(roomId: string, socket: WebSocket, memberId?: string): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
    }
    room.add(socket);
    this.roomOf.set(socket, roomId);
    if (memberId !== undefined) {
      this.memberOf.set(socket, memberId);
    }
  }

  leave(socket: WebSocket): void {
    this.memberOf.delete(socket);
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
  broadcast<T extends object>(
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

  /**
   * 방 안에서 그 회원의 소켓에만 보낸다(같은 회원이 여러 기기로 접속했으면 전부).
   * 접속해 있지 않으면 아무 일도 일어나지 않는다 — 방이 프로세스 로컬이라 "접속 중인가"를
   * 이 레지스트리로 판정할 수 없으므로, 보내는 쪽도 도달을 전제하지 않는다.
   */
  sendToMember<T extends object>(
    roomId: string,
    memberId: string,
    event: WsServerEvent<T>,
  ): void {
    for (const socket of this.rooms.get(roomId) ?? []) {
      if (this.memberOf.get(socket) === memberId) {
        sendEvent(socket, event);
      }
    }
  }
}
