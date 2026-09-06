import { WsAdapter } from '@nestjs/platform-ws';
import { MessageMappingProperties } from '@nestjs/websockets';
import { EMPTY, Observable } from 'rxjs';

/**
 * 계약의 명령 봉투 { id, type, payload, ... }를 Nest 핸들러에 연결한다.
 * 기본 WsAdapter는 { event, data }를 기대하고 data만 핸들러에 넘기므로,
 * type으로 핸들러를 찾고 봉투 전체를 넘기도록 이 메서드 하나만 바꾼다.
 * JSON이 아니거나 type에 맞는 핸들러가 없으면 기본 어댑터와 같이 무시한다.
 */
export class CommandEnvelopeWsAdapter extends WsAdapter {
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
}
