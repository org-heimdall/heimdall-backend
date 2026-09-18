import { WebSocket } from 'ws';

// 서버 → 클라이언트 이벤트 봉투. 계약의 모든 WS 이벤트가 이 모양이다.
export interface WsServerEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
}

// 접속 후 거절(인증 실패·리소스 없음 등)에 쓰는 close code. RFC 6455의 1008(Policy Violation).
export const CLOSE_POLICY_VIOLATION = 1008;

// 닫힌 소켓에 보내면 ws가 throw하므로 열린 경우에만 보낸다(브로드캐스트 중 끊긴 소켓 방어).
export function sendEvent<T>(socket: WebSocket, event: WsServerEvent<T>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}
