import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { ClosableSocket } from './ws-close';
import { HEARTBEAT_INTERVAL_MS, installHeartbeat } from './ws-heartbeat';

// ws 서버·소켓 중 heartbeat가 실제로 건드리는 부분(clients, connection/pong 이벤트,
// ping·terminate, readyState)만 세운다.
class FakeSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  closeInfo?: ClosableSocket['closeInfo'];
  ping = jest.fn();
  terminate = jest.fn();
}

function serverWith(...sockets: FakeSocket[]): WebSocketServer {
  const server = new EventEmitter() as unknown as WebSocketServer;
  (server as { clients: Set<unknown> }).clients = new Set(sockets);
  return server;
}

describe('installHeartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('주기마다 ping을 보내고, pong이 오면 연결을 유지한다', () => {
    const socket = new FakeSocket();
    const server = serverWith(socket);
    installHeartbeat(server);
    server.emit('connection', socket);

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(socket.ping).toHaveBeenCalledTimes(1);

    socket.emit('pong');
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(socket.ping).toHaveBeenCalledTimes(2);
  });

  it('pong이 한 주기 동안 오지 않으면 원인을 남기고 끊는다', () => {
    const socket = new FakeSocket();
    const server = serverWith(socket);
    installHeartbeat(server);
    server.emit('connection', socket);

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS); // ping 발송
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS); // 응답 없음 → 정리

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(socket.closeInfo).toEqual({
      code: 1006,
      reason: 'keepalive 미응답',
    });
  });

  it('서버가 닫히면 타이머를 멈춘다', () => {
    const socket = new FakeSocket();
    const server = serverWith(socket);
    installHeartbeat(server);
    server.emit('connection', socket);

    server.emit('close');
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(socket.ping).not.toHaveBeenCalled();
  });
});
