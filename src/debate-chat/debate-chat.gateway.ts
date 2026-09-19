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
  wsEvent,
} from '../common/ws/ws-event';
import { parseBearerToken, parseRoomId } from '../common/ws/ws-handshake';
import { DEBATE_CHAT_WS_PATH } from '../common/ws/ws.config';
import { DEBATE_CHAT_WS_PORT } from './debate-chat.config';
import {
  DebateTurnFinalizeCommandDto,
  DebateTurnMessageSendCommandDto,
} from './debate-chat.dto';
import {
  DebateChatExceptionFilter,
  toAppError,
} from './debate-chat.exception-filter';
import { DebateChatPublisher } from './debate-chat.publisher';
import { DebateChatService } from './debate-chat.service';
import {
  DebateChatCommand,
  DebateChatEvent,
  TurnMessageAckPayload,
} from './debate-chat.types';

// 인증·경로 검증이 끝난 뒤 소켓에 붙여 두는 접속 컨텍스트.
export interface DebateChatSocket extends WebSocket {
  debateId?: string;
  memberId?: string;
}

// 계약 경로: /debates/:debateId/chat
const PATH_PATTERN = /^\/debates\/([^/]+)\/chat\/?$/;

/**
 * 토론 채팅 게이트웨이. 계약의 단일 WS 서버(DEBATE_CHAT_WS_PORT)에서 경로를 직접 해석한다.
 * 명령은 CommandEnvelopeWsAdapter가 type으로 찾아 봉투 전체를 넘기고, payload는 HTTP와 같은 ValidationPipe로 검증한다.
 * 요청 소켓 대상 응답(restored/ack/error)은 여기서, 방 전체 이벤트는 서비스/파이프라인이 publisher로 보낸다.
 */
@WebSocketGateway(DEBATE_CHAT_WS_PORT, { path: DEBATE_CHAT_WS_PATH })
@UseFilters(DebateChatExceptionFilter)
@UsePipes(createValidationPipe())
export class DebateChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DebateChatGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly service: DebateChatService,
    private readonly publisher: DebateChatPublisher,
  ) {}

  // handshake 직후. 경로·토큰을 검증하고 방에 넣은 뒤 connection.restored를 보낸다.
  // 이 단계의 예외는 예외 필터를 타지 않으므로 직접 error 이벤트를 보내고 닫는다.
  async handleConnection(
    client: DebateChatSocket,
    request: IncomingMessage,
  ): Promise<void> {
    try {
      const debateId = parseRoomId(request.url, PATH_PATTERN);
      client.memberId = this.tokenService.verifyAccessToken(
        parseBearerToken(request),
      ).sub;
      client.debateId = debateId;
      this.publisher.join(debateId, client);

      const snapshot = await this.service.restore(debateId);
      // 접속마다 한 번뿐인 이벤트라 id를 파생하지 않는다(재접속은 새 사실이다).
      this.send(client, wsEvent(DebateChatEvent.CONNECTION_RESTORED, snapshot));
      this.logger.log(
        `접속: debateId=${debateId}, memberId=${client.memberId}, room=${this.publisher.size(debateId)}`,
      );
    } catch (error) {
      const appError = toAppError(error, this.logger);
      this.send(
        client,
        wsEvent(DebateChatEvent.ERROR, {
          debateId: client.debateId,
          code: appError.code,
          message: appError.detail,
        }),
      );
      this.publisher.leave(client);
      client.close(CLOSE_POLICY_VIOLATION, appError.code);
    }
  }

  handleDisconnect(client: DebateChatSocket): void {
    this.publisher.leave(client);
    if (client.debateId) {
      this.logger.log(
        `종료: debateId=${client.debateId}, memberId=${client.memberId}, room=${this.publisher.size(client.debateId)}`,
      );
    }
  }

  @SubscribeMessage(DebateChatCommand.TURN_SEND)
  async onTurnSend(
    @ConnectedSocket() client: DebateChatSocket,
    @MessageBody() command: DebateTurnMessageSendCommandDto,
  ): Promise<WsServerEvent<TurnMessageAckPayload>> {
    return this.appendDraft(client, command);
  }

  @SubscribeMessage(DebateChatCommand.TURN_MESSAGE_SEND)
  async onTurnMessageSend(
    @ConnectedSocket() client: DebateChatSocket,
    @MessageBody() command: DebateTurnMessageSendCommandDto,
  ): Promise<WsServerEvent<TurnMessageAckPayload>> {
    return this.appendDraft(client, command);
  }

  // finalize는 별도 ACK가 없다. 요청자도 방에 있으므로 브로드캐스트되는 finalized로 결과를 받는다.
  @SubscribeMessage(DebateChatCommand.TURN_FINALIZE)
  async onTurnFinalize(
    @ConnectedSocket() client: DebateChatSocket,
    @MessageBody() command: DebateTurnFinalizeCommandDto,
  ): Promise<void> {
    const { debateId, memberId } = this.contextOf(client);
    await this.service.finalizeTurn(debateId, memberId, command.payload);
  }

  // APPENDED면 송신자를 제외한 방에 created를 보내고, 반환값(ack)은 Nest가 요청 소켓에만 보낸다.
  private async appendDraft(
    client: DebateChatSocket,
    command: DebateTurnMessageSendCommandDto,
  ): Promise<WsServerEvent<TurnMessageAckPayload>> {
    const { debateId, memberId } = this.contextOf(client);
    const result = await this.service.appendDraft(
      debateId,
      memberId,
      command.payload,
      command.clientMessageId,
    );

    if (result.status === 'APPENDED') {
      this.publisher.messageCreated(debateId, result.message, client);
    }
    // 명령 하나에 ack 하나라 commandId에서 파생한다 — 재전송하면 같은 ack id로 다시 온다.
    return wsEvent(
      DebateChatEvent.TURN_MESSAGE_ACK,
      {
        debateId,
        commandId: command.id,
        clientMessageId: command.clientMessageId,
        status: result.status,
        message: result.message,
      },
      [command.id],
    );
  }

  // handleConnection이 끝난 소켓만 명령을 보낼 수 있으므로 컨텍스트는 항상 있다.
  private contextOf(client: DebateChatSocket): {
    debateId: string;
    memberId: string;
  } {
    if (!client.debateId || !client.memberId) {
      throw new GeneralException(AuthErrorCode.UNAUTHORIZED);
    }
    return { debateId: client.debateId, memberId: client.memberId };
  }

  private send<T extends object>(
    client: WebSocket,
    event: WsServerEvent<T>,
  ): void {
    sendEvent(client, event);
  }
}
