import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { CLOSE_POLICY_VIOLATION } from './ws-event';

/**
 * 종료 원인 진단용 close 정보를 실어 두는 소켓.
 *
 * Nest의 WsAdapter는 close 콜백을 인자 없이 부르므로(web-sockets-controller가
 * `() => disconnect.next(client)`로 감싼다) handleDisconnect가 code·reason을 받을 길이 없다.
 * CommandEnvelopeWsAdapter가 close 이벤트에서 여기에 채워 두고, 게이트웨이가 읽어 로그로 남긴다.
 */
export interface ClosableSocket extends WebSocket {
  closeInfo?: { code: number; reason: string };
  session?: SocketSession;
}

// 접속 로그와 종료 로그를 같은 TCP 연결로 잇기 위한 값.
interface SocketSession {
  peer: string;
  openedAt: number;
}

/**
 * handshake의 TCP 정보를 소켓에 적어 둔다.
 *
 * 기기를 가르는 것은 memberId가 아니라 이 주소다 — 같은 계정이 여러 기기로 접속할 수 있고,
 * 반대로 한 기기가 끊었다 붙으면 memberId는 같아도 다른 연결이다.
 */
export function openSession(
  socket: ClosableSocket,
  request: IncomingMessage,
): void {
  socket.session = {
    peer: `${request.socket.remoteAddress ?? '?'}:${request.socket.remotePort ?? '?'}`,
    openedAt: Date.now(),
  };
}

// 접속·종료 로그의 기기 꼬리표.
export function describePeer(socket: ClosableSocket): string {
  return `peer=${socket.session?.peer ?? '?'}`;
}

/**
 * 연결이 얼마나 살아 있었는지. 고정된 타임아웃(항상 같은 초에 끊김)과 사용자 행위에 따른
 * 끊김(들쭉날쭉)을 가르는 값이라 종료 로그에 함께 남긴다.
 */
export function describeUptime(socket: ClosableSocket): string {
  const session = socket.session;
  if (session === undefined) {
    return '유지=?';
  }
  return `유지=${((Date.now() - session.openedAt) / 1000).toFixed(1)}s`;
}

// RFC 6455의 close code 중 원인 구분에 실제로 쓰이는 것만. 로그를 읽는 사람을 위한 것이라
// 전부 나열하지 않고, 모르는 코드는 숫자만 남긴다.
const CLOSE_LABELS: Readonly<Record<number, string>> = {
  1000: '정상 종료',
  1001: '떠남(백그라운드 전환·화면 이탈)',
  1005: '코드 없음',
  1006: '비정상(close 프레임 없이 끊김)',
  [CLOSE_POLICY_VIOLATION]: '정책 위반(서버가 거절)',
  1011: '서버 내부 오류',
  1012: '서비스 재시작',
};

/**
 * 종료 로그 꼬리표. 클라이언트가 스스로 닫았는지(1000·1001) 네트워크가 끊은 것인지(1006)를
 * 가르는 것이 목적이다 — 전자는 앱 생명주기, 후자는 keepalive·NAT 쪽을 본다.
 */
export function describeClose(socket: ClosableSocket): string {
  const info = socket.closeInfo;
  if (info === undefined) {
    return 'code=?';
  }
  const label = CLOSE_LABELS[info.code];
  const code = label === undefined ? `${info.code}` : `${info.code}(${label})`;
  return info.reason === ''
    ? `code=${code}`
    : `code=${code}, reason=${info.reason}`;
}
