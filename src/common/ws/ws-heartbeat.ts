import { WebSocket, WebSocketServer } from 'ws';
import { ClosableSocket } from './ws-close';

// 서버가 ping을 보내는 주기. 유휴 연결이 중간 장비(에뮬레이터 NAT·프록시)에서 조용히
// 끊기는 것을 막는 것이 목적이라, 흔한 아이들 타임아웃(보통 60초 이상)보다 짧게 잡는다.
export const HEARTBEAT_INTERVAL_MS = 30_000;

// 한 주기 안에 pong이 오지 않으면 죽은 연결로 보고 끊는다. 상대가 사라졌는데도 방에 남아
// 브로드캐스트를 받는(그리고 room 수를 부풀리는) 유령 소켓을 여기서 정리한다.
const NO_PONG_REASON = 'keepalive 미응답';

type HeartbeatSocket = ClosableSocket & { isAlive?: boolean };

/**
 * ws 서버에 ping/pong keepalive를 건다.
 *
 * WebSocket 프로토콜의 ping/pong은 프레임 수준이라 애플리케이션 이벤트와 섞이지 않는다.
 * 클라이언트(Dart의 dart:io WebSocket 포함)는 ping에 자동으로 pong을 돌려주므로 프론트 수정이 필요 없다.
 */
export function installHeartbeat(server: WebSocketServer): void {
  server.on('connection', (socket: HeartbeatSocket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
  });

  const timer = setInterval(() => {
    for (const socket of server.clients as Set<HeartbeatSocket>) {
      if (socket.isAlive === false) {
        // terminate는 close 프레임 없이 끊어 1006으로 기록되므로, 네트워크 드롭과
        // 구분되도록 원인을 먼저 적어 둔다(close 핸들러가 덮어쓰지 않는다).
        socket.closeInfo = { code: 1006, reason: NO_PONG_REASON };
        socket.terminate();
        continue;
      }
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // 타이머 때문에 프로세스가 종료되지 못하는 일이 없게 한다(DeadlineScheduler와 같은 이유).
  timer.unref();
  server.on('close', () => clearInterval(timer));
}
