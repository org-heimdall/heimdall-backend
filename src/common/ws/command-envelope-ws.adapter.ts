import { WsAdapter } from '@nestjs/platform-ws';
import { MessageMappingProperties } from '@nestjs/websockets';
import * as http from 'node:http';
import { EMPTY, Observable } from 'rxjs';

/**
 * 계약의 명령 봉투 { id, type, payload, ... }를 Nest 핸들러에 연결하고,
 * 한 포트에 올라간 여러 게이트웨이를 경로 접두사로 가른다.
 *
 * 기본 WsAdapter는 (1) { event, data }를 기대하며 data만 핸들러에 넘기고,
 * (2) upgrade 요청을 `pathname === wsServer.path` 완전 일치로만 라우팅한다.
 * 계약 경로는 /debates/:id/chat처럼 동적이라 완전 일치로는 매칭되지 않으므로 두 지점만 바꾼다.
 */
export class CommandEnvelopeWsAdapter extends WsAdapter {
  // type으로 핸들러를 찾고 봉투 전체를 넘긴다.
  // JSON이 아니거나 type에 맞는 핸들러가 없으면 기본 어댑터와 같이 무시한다.
  bindMessageHandler(
    buffer: { data: string | Buffer },
    handlersMap: Map<string, MessageMappingProperties>,
    transform: (data: unknown) => Observable<unknown>,
  ): Observable<unknown> {
    try {
      const message = JSON.parse(buffer.data.toString()) as { type?: string };
      const handler =
        typeof message.type === 'string'
          ? handlersMap.get(message.type)
          : undefined;
      if (!handler) {
        return EMPTY;
      }
      return transform(handler.callback(message));
    } catch {
      return EMPTY;
    }
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
}

// 게이트웨이 경로 자체이거나 그 하위 경로면 해당 게이트웨이가 처리한다.
// '/debates'가 '/debates-archive'를 가로채지 않도록 구분자('/')까지 함께 본다.
function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}
