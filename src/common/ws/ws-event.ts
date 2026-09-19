import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

/**
 * 서버 → 클라이언트 이벤트 봉투. 계약의 모든 WS 이벤트가 이 모양이다.
 * 이벤트별 데이터는 payload로 중첩하지 않고 최상위에 펼친다(계약의 flat wire format).
 * 따라서 데이터 쪽에 id·type이라는 이름의 필드를 두면 봉투와 충돌한다.
 */
export type WsServerEvent<TData extends object = object> = {
  id: string;
  type: string;
} & TData;

// 이벤트 id를 파생하는 UUIDv5 네임스페이스. 바뀌면 같은 이벤트가 다른 id를 갖게 되므로 고정값이다.
const EVENT_ID_NAMESPACE = '6f1d2a7c5c3e5a1b9a6f0b3d2c4e5f70';

/**
 * 이벤트 하나를 만든다. identity를 주면 그 값에서 id를 결정적으로 파생하고, 생략하면 매번 새 id를 만든다.
 *
 * 재접속 replay로 다시 나가는 이벤트는 실시간으로 받았던 것과 id가 같아야 프론트가 중복을 걸러낼 수
 * 있다. 그래서 identity에는 "같은 사실이면 같고 다른 사실이면 다른" 값을 넣는다 — 대개 엔티티 id이고,
 * 갱신되는 것(의견)은 갱신 시각까지 넣어야 수정 전후가 다른 이벤트가 된다.
 *
 * 반대로 같은 값으로 여러 번 일어날 수 있는 이벤트(의사 변경 토글)나 접속마다 한 번인 이벤트
 * (connection.restored)는 identity를 생략한다. 결정적 id를 주면 두 번째 이벤트가 중복으로 버려진다.
 */
export function wsEvent<TData extends object>(
  type: string,
  data: TData,
  identity?: readonly (string | number)[],
): WsServerEvent<TData> {
  const id =
    identity === undefined
      ? randomUUID()
      : deriveEventId(`${type}|${identity.join('|')}`);

  // data가 id·type을 덮어쓰지 않는다는 전제 위에 있다(봉투 타입 주석 참고).
  return { id, type, ...data };
}

// RFC 4122 UUIDv5(SHA-1 기반). 이것 하나 때문에 uuid 패키지를 들이지 않는다.
function deriveEventId(name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(EVENT_ID_NAMESPACE, 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 10x

  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// 접속 후 거절(인증 실패·리소스 없음 등)에 쓰는 close code. RFC 6455의 1008(Policy Violation).
export const CLOSE_POLICY_VIOLATION = 1008;

// 닫힌 소켓에 보내면 ws가 throw하므로 열린 경우에만 보낸다(브로드캐스트 중 끊긴 소켓 방어).
export function sendEvent<T extends object>(
  socket: WebSocket,
  event: WsServerEvent<T>,
): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}
