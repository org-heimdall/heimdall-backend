import { Catch } from '@nestjs/common';
import { WsCommandExceptionFilter } from '../common/ws/ws-exception.filter';
import { CommunityChatSocket } from './community-chat.gateway';

// 계약의 error 이벤트 payload에 communityId를 실어 보낸다. 나머지는 공통 필터가 처리한다.
@Catch()
export class CommunityChatExceptionFilter extends WsCommandExceptionFilter<CommunityChatSocket> {
  protected scopeOf(
    client: CommunityChatSocket,
  ): Record<string, string | undefined> {
    return { communityId: client.communityId };
  }
}
