import { Logger, UseFilters, UsePipes } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { AuthErrorCode } from '../auth/exceptions/auth-error-code';
import { TokenService } from '../auth/token.service';
import { GeneralException } from '../common/exceptions/general.exception';
import { createValidationPipe } from '../common/pipes/validation-pipe.factory';
import {
  CLOSE_POLICY_VIOLATION,
  sendEvent,
  WsServerEvent,
} from '../common/ws/ws-event';
import { toAppError } from '../common/ws/ws-exception.filter';
import { parseBearerToken, parseRoomId } from '../common/ws/ws-handshake';
import { CHAT_WS_PORT, COMMUNITY_CHAT_WS_PATH } from '../common/ws/ws.config';
import {
  CommunityMessageSendCommandDto,
  CommunityOpinionSubmitCommandDto,
} from './community-chat.dto';
import { CommunityChatExceptionFilter } from './community-chat.exception-filter';
import { CommunityChatPublisher } from './community-chat.publisher';
import { CommunityChatService } from './community-chat.service';
import {
  CommunityChatCommand,
  CommunityChatEvent,
  MessageAckPayload,
  OPINION_ACK_STATUS,
  OpinionAckPayload,
} from './community-chat.types';

// 인증·경로 검증이 끝난 뒤 소켓에 붙여 두는 접속 컨텍스트.
export interface CommunityChatSocket extends WebSocket {
  communityId?: string;
  memberId?: string;
}

// 계약 경로: /communities/:communityId/chat
const PATH_PATTERN = /^\/communities\/([^/]+)\/chat\/?$/;

/**
 * 커뮤니티 채팅 게이트웨이. 토론 채팅과 같은 WS 서버(CHAT_WS_PORT)를 쓰고,
 * 어댑터가 경로 접두사(/communities)로 이쪽 게이트웨이를 고른다.
 * 관전(비참여자 접속)은 허용하고 명령만 참여자로 제한한다.
 */
@WebSocketGateway(CHAT_WS_PORT, { path: COMMUNITY_CHAT_WS_PATH })
@UseFilters(CommunityChatExceptionFilter)
@UsePipes(createValidationPipe())
export class CommunityChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CommunityChatGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly service: CommunityChatService,
    private readonly publisher: CommunityChatPublisher,
  ) {}

  // handshake 직후. 경로·토큰을 검증하고 방에 넣은 뒤 최근 메시지와 의견을 replay한다.
  // 이 단계의 예외는 예외 필터를 타지 않으므로 직접 error 이벤트를 보내고 닫는다.
  async handleConnection(
    client: CommunityChatSocket,
    request: IncomingMessage,
  ): Promise<void> {
    try {
      const communityId = parseRoomId(request.url, PATH_PATTERN);
      client.memberId = this.tokenService.verifyAccessToken(
        parseBearerToken(request),
      ).sub;
      await this.service.assertJoinable(communityId);
      client.communityId = communityId;
      this.publisher.join(communityId, client);

      await this.replay(client, communityId);
      this.logger.log(
        `접속: communityId=${communityId}, memberId=${client.memberId}, room=${this.publisher.size(communityId)}`,
      );
    } catch (error) {
      const appError = toAppError(error, this.logger);
      sendEvent(client, {
        type: CommunityChatEvent.ERROR,
        payload: {
          communityId: client.communityId,
          code: appError.code,
          message: appError.detail,
        },
      });
      this.publisher.leave(client);
      client.close(CLOSE_POLICY_VIOLATION, appError.code);
    }
  }

  handleDisconnect(client: CommunityChatSocket): void {
    this.publisher.leave(client);
    if (client.communityId) {
      this.logger.log(
        `종료: communityId=${client.communityId}, memberId=${client.memberId}, room=${this.publisher.size(client.communityId)}`,
      );
    }
  }

  // STORED면 송신자를 제외한 방에 created를 보내고, 반환값(ack)은 Nest가 요청 소켓에만 보낸다.
  @SubscribeMessage(CommunityChatCommand.MESSAGE_SEND)
  async onMessageSend(
    @ConnectedSocket() client: CommunityChatSocket,
    @MessageBody() command: CommunityMessageSendCommandDto,
  ): Promise<WsServerEvent<MessageAckPayload>> {
    const { communityId, memberId } = this.contextOf(client);
    const result = await this.service.sendMessage(
      communityId,
      memberId,
      command.payload.text,
      command.clientMessageId,
    );

    if (result.status === 'STORED') {
      this.publisher.messageCreated(communityId, result.message, client);
    }
    return {
      type: CommunityChatEvent.MESSAGE_ACK,
      payload: {
        communityId,
        commandId: command.id,
        clientMessageId: command.clientMessageId,
        status: result.status,
        message: result.message,
      },
    };
  }

  @SubscribeMessage(CommunityChatCommand.OPINION_SUBMIT)
  async onOpinionSubmit(
    @ConnectedSocket() client: CommunityChatSocket,
    @MessageBody() command: CommunityOpinionSubmitCommandDto,
  ): Promise<WsServerEvent<OpinionAckPayload>> {
    const { communityId, memberId } = this.contextOf(client);
    const opinion = await this.service.submitOpinion(
      communityId,
      memberId,
      command.payload,
    );

    this.publisher.opinionSubmitted(communityId, opinion, client);
    return {
      type: CommunityChatEvent.OPINION_ACK,
      payload: {
        communityId,
        commandId: command.id,
        status: OPINION_ACK_STATUS,
        opinion,
      },
    };
  }

  // 계약상 스냅샷 이벤트가 없으므로, 방금 접속한 소켓에만 평소와 같은 이벤트를 순서대로 다시 보낸다.
  private async replay(
    client: CommunityChatSocket,
    communityId: string,
  ): Promise<void> {
    const { messages, opinions } = await this.service.replay(communityId);

    for (const message of messages) {
      sendEvent(client, {
        type: CommunityChatEvent.MESSAGE_CREATED,
        payload: { communityId, message },
      });
    }
    for (const opinion of opinions) {
      sendEvent(client, {
        type: CommunityChatEvent.OPINION_SUBMITTED,
        payload: { communityId, opinion },
      });
    }
  }

  // handleConnection이 끝난 소켓만 명령을 보낼 수 있으므로 컨텍스트는 항상 있다.
  private contextOf(client: CommunityChatSocket): {
    communityId: string;
    memberId: string;
  } {
    if (!client.communityId || !client.memberId) {
      throw new GeneralException(AuthErrorCode.UNAUTHORIZED);
    }
    return { communityId: client.communityId, memberId: client.memberId };
  }
}
