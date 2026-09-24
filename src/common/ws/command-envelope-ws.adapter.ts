import { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { MessageMappingProperties } from '@nestjs/websockets';
import * as http from 'node:http';
import { performance } from 'node:perf_hooks';
import { EMPTY, finalize, Observable, tap } from 'rxjs';
import { WebSocket, WebSocketServer } from 'ws';
import {
  UNKNOWN_COMMAND_TYPE,
  WsCommandOutcome,
  WsMetrics,
} from '../metrics/ws.metrics';
import { ClosableSocket } from './ws-close';
import { isCommandFailed } from './ws-command-outcome';
import { installHeartbeat } from './ws-heartbeat';

// 게이트웨이 path를 알 수 없을 때의 gateway label.
const UNKNOWN_GATEWAY = 'unknown';

/**
 * 계약의 명령 봉투 { id, type, payload, ... }를 Nest 핸들러에 연결하고,
 * 한 포트에 올라간 여러 게이트웨이를 경로 접두사로 가른다.
 *
 * 기본 WsAdapter는 (1) { event, data }를 기대하며 data만 핸들러에 넘기고,
 * (2) upgrade 요청을 `pathname === wsServer.path` 완전 일치로만 라우팅하며,
 * (3) close 콜백을 인자 없이 불러 종료 원인(code·reason)을 게이트웨이에 전달하지 않으며,
 * (4) ping/pong keepalive가 없어 유휴 연결이 조용히 끊겨도 서버가 알지 못한다.
 * 계약 경로는 /debates/:id/chat처럼 동적이라 완전 일치로는 매칭되지 않으므로 이 네 지점만 바꾼다.
 * 모든 연결·명령이 이곳을 지나므로 WS 메트릭(연결 수·명령 수·처리 시간)도 여기서 기록한다.
 */
export class CommandEnvelopeWsAdapter extends WsAdapter {
  // 소켓이 어느 게이트웨이(path) 소속인지. 메시지 핸들러는 소켓만 알 수 있어 연결 시점에 적어 둔다.
  private readonly gatewayOfSocket = new WeakMap<WebSocket, string>();

  constructor(
    app: INestApplicationContext,
    private readonly metrics: WsMetrics,
  ) {
    super(app);
  }

  /**
   * type으로 핸들러를 찾고 봉투 전체를 넘긴다.
   * JSON이 아니거나 type에 맞는 핸들러가 없으면 기본 어댑터와 같이 무시하되 type=unknown으로 센다.
   *
   * 처리 시간은 핸들러 호출 직전부터 반환 Observable이 끝날 때(완료·에러·연결 종료로 인한 구독 해제)까지다.
   * 핸들러 예외는 WsProxy가 삼켜 Observable이 정상 완료되므로, 예외 필터가 남긴 표식으로 error를 가른다.
   * buffer는 ws의 MessageEvent라(rxjs fromEvent가 addEventListener로 구독) target이 보낸 소켓이다.
   */
  bindMessageHandler(
    buffer: { data: string | Buffer; target?: WebSocket },
    handlersMap: Map<string, MessageMappingProperties>,
    transform: (data: unknown) => Observable<unknown>,
  ): Observable<unknown> {
    const startedAt = performance.now();
    const gateway =
      (buffer.target && this.gatewayOfSocket.get(buffer.target)) ??
      UNKNOWN_GATEWAY;

    const message = parseEnvelope(buffer.data);
    const handler =
      typeof message?.type === 'string'
        ? handlersMap.get(message.type)
        : undefined;
    if (!message || !handler) {
      this.recordCommand(gateway, UNKNOWN_COMMAND_TYPE, 'error', startedAt);
      return EMPTY;
    }

    const type = handler.message as string;
    let errored = false;
    try {
      return transform(handler.callback(message)).pipe(
        tap({ error: () => (errored = true) }),
        finalize(() =>
          this.recordCommand(
            gateway,
            type,
            errored || isCommandFailed(message) ? 'error' : 'ok',
            startedAt,
          ),
        ),
      );
    } catch {
      this.recordCommand(gateway, type, 'error', startedAt);
      return EMPTY;
    }
  }

  /**
   * 이 어댑터가 만드는 모든 ws 서버(포트당 게이트웨이마다 하나)에 keepalive를 걸고 연결 수를 센다.
   * 연결 수는 게이트웨이의 handleDisconnect 구현 여부와 무관하도록 소켓의 close 이벤트로 직접 줄인다.
   */
  create(port: number, options?: Record<string, unknown>): unknown {
    const server = super.create(port, options) as WebSocketServer;
    installHeartbeat(server);

    const gateway =
      typeof options?.path === 'string' ? options.path : UNKNOWN_GATEWAY;
    server.on('connection', (socket: WebSocket) => {
      this.gatewayOfSocket.set(socket, gateway);
      this.metrics.connectionOpened(gateway);
      socket.once('close', () => this.metrics.connectionClosed(gateway));
    });
    return server;
  }

  /**
   * 기본 구현은 close 리스너로 콜백을 그대로 달아, Nest가 인자를 버린 콜백만 남는다.
   * 종료 원인을 소켓에 적어 둔 뒤 콜백을 불러, handleDisconnect가 describeClose로 읽게 한다.
   */
  bindClientDisconnect(client: ClosableSocket, callback: () => void): void {
    client.on('close', (code: number, reason: Buffer) => {
      // keepalive가 끊은 경우엔 이미 원인이 적혀 있다 — 그 쪽이 1006보다 정확하다.
      client.closeInfo ??= { code, reason: reason.toString() };
      callback();
    });
  }

  /**
   * 포트당 하나뿐인 http 서버의 upgrade 핸들러. 게이트웨이의 path를 경로 접두사로 보고
   * 그 아래 동적 경로(/debates/:id/chat)까지 같은 게이트웨이로 넘긴다.
   * 나머지 정책(미매칭 시 socket.destroy, 예외 시 400)은 기본 어댑터와 같다.
   */
  protected ensureHttpServerExists(
    port: number,
    httpServer: http.Server = http.createServer(),
  ): http.Server | undefined {
    if (this.httpServersRegistry.has(port)) {
      return;
    }
    this.httpServersRegistry.set(port, httpServer);

    httpServer.on('upgrade', (request, socket, head) => {
      try {
        const pathname = new URL(
          request.url ?? '/',
          `ws://${request.headers.host}/`,
        ).pathname;
        const wsServer = (this.wsServersRegistry.get(port) ?? []).find(
          (candidate: { path: string }) =>
            matchesPath(pathname, candidate.path),
        ) as
          | {
              handleUpgrade: (
                request: http.IncomingMessage,
                socket: unknown,
                head: unknown,
                callback: (ws: unknown) => void,
              ) => void;
              emit: (event: string, ...args: unknown[]) => void;
            }
          | undefined;

        if (!wsServer) {
          socket.destroy();
          return;
        }
        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit('connection', ws, request);
        });
      } catch (error) {
        socket.end(
          `HTTP/1.1 400\r\n${error instanceof Error ? error.message : ''}`,
        );
      }
    });

    return httpServer;
  }

  // 명령 1건의 소요 시간을 초 단위로 환산해 기록한다.
  private recordCommand(
    gateway: string,
    type: string,
    outcome: WsCommandOutcome,
    startedAt: number,
  ): void {
    this.metrics.recordCommand(
      gateway,
      type,
      outcome,
      (performance.now() - startedAt) / 1000,
    );
  }
}

// 명령 봉투를 파싱한다. JSON이 아니거나 객체가 아니면 null이다.
function parseEnvelope(data: string | Buffer): { type?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(data.toString());
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// 게이트웨이 경로 자체이거나 그 하위 경로면 해당 게이트웨이가 처리한다.
// '/debates'가 '/debates-archive'를 가로채지 않도록 구분자('/')까지 함께 본다.
function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}
