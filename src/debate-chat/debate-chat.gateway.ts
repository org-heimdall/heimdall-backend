import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { AuthErrorCode } from '../auth/exceptions/auth-error-code';
import { TokenService } from '../auth/token.service';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { validationExceptionFactory } from '../common/exceptions/validation-exception.factory';
import { DEBATE_CHAT_WS_PORT } from './debate-chat.config';
import {
  DebateTurnFinalizeCommandDto,
  DebateTurnMessageSendCommandDto,
} from './debate-chat.dto';
import {
  DebateChatExceptionFilter,
  toAppError,
} from './debate-chat.exception-filter';
import { DebateChatPublisher, sendEvent } from './debate-chat.publisher';
import { DebateChatService } from './debate-chat.service';
import {
  DebateChatCommand,
  DebateChatEvent,
  TurnMessageAckPayload,
  WsServerEvent,
} from './debate-chat.types';

// 인증·경로 검증이 끝난 뒤 소켓에 붙여 두는 접속 컨텍스트.
export interface DebateChatSocket extends WebSocket {
  debateId?: string;
  memberId?: string;
}

// 접속 후 거절(인증 실패·토론 없음 등)에 쓰는 close code. RFC 6455의 1008(Policy Violation).
const CLOSE_POLICY_VIOLATION = 1008;

// 계약 경로: /debates/:debateId/chat
const PATH_PATTERN = /^\/debates\/([^/]+)\/chat\/?$/;

/**
 * 토론 채팅 게이트웨이. 계약의 단일 WS 서버(DEBATE_CHAT_WS_PORT)에서 경로를 직접 해석한다.
 * 명령은 CommandEnvelopeWsAdapter가 type으로 찾아 봉투 전체를 넘기고, payload는 HTTP와 같은 ValidationPipe로 검증한다.
 * 요청 소켓 대상 응답(restored/ack/error)은 여기서, 방 전체 이벤트는 서비스/파이프라인이 publisher로 보낸다.
 */
@WebSocketGateway(DEBATE_CHAT_WS_PORT)
@UseFilters(DebateChatExceptionFilter)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  }),
)
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
      const debateId = this.parseDebateId(request.url);
      client.memberId = this.authenticate(request);
      client.debateId = debateId;
      this.publisher.join(debateId, client);

      const snapshot = await this.service.restore(debateId);
      this.send(client, {
        type: DebateChatEvent.CONNECTION_RESTORED,
        payload: snapshot,
      });
      this.logger.log(
        `접속: debateId=${debateId}, memberId=${client.memberId}, room=${this.publisher.size(debateId)}`,
      );
    } catch (error) {
      const appError = toAppError(error, this.logger);
      this.send(client, {
        type: DebateChatEvent.ERROR,
        payload: {
          debateId: client.debateId,
          code: appError.code,
          message: appError.detail,
        },
      });
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

  // STORED면 송신자를 제외한 방에 created를 보내고, 반환값(ack)은 Nest가 요청 소켓에만 보낸다.
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

    if (result.status === 'STORED') {
      this.publisher.messageCreated(debateId, result.message, client);
    }
    return {
      type: DebateChatEvent.TURN_MESSAGE_ACK,
      payload: {
        debateId,
        commandId: command.id,
        clientMessageId: command.clientMessageId,
        status: result.status,
        message: result.message,
      },
    };
  }

  private parseDebateId(url: string | undefined): string {
    const pathname = new URL(url ?? '/', 'ws://placeholder').pathname;
    const matched = PATH_PATTERN.exec(pathname);
    if (!matched) {
      throw new GeneralException(ErrorCode.NOT_FOUND);
    }
    const debateId = decodeURIComponent(matched[1]);
    if (!isUUID(debateId)) {
      throw new GeneralException(ErrorCode.INVALID_INPUT);
    }
    return debateId;
  }

  // 계약: handshake의 Authorization: Bearer <accessToken> 헤더.
  private authenticate(request: IncomingMessage): string {
    const header = request.headers.authorization;
    if (!header) {
      throw new GeneralException(AuthErrorCode.UNAUTHORIZED);
    }
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new GeneralException(AuthErrorCode.INVALID_TOKEN);
    }
    return this.tokenService.verifyAccessToken(token).sub;
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

  private send<T>(client: WebSocket, event: WsServerEvent<T>): void {
    sendEvent(client, event);
  }
}
