import { Catch } from '@nestjs/common';
import {
  toAppError,
  WsCommandExceptionFilter,
} from '../common/ws/ws-exception.filter';
import { DebateChatSocket } from './debate-chat.gateway';

export { toAppError };

// 계약의 error 이벤트에 debateId를 실어 보낸다. 나머지는 공통 필터가 처리한다.
@Catch()
export class DebateChatExceptionFilter extends WsCommandExceptionFilter<DebateChatSocket> {
  protected scopeOf(
    client: DebateChatSocket,
  ): Record<string, string | undefined> {
    return { debateId: client.debateId };
  }
}
