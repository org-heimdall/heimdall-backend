import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../../auth/token.service';
import { AuthErrorCode } from '../../auth/exceptions/auth-error-code';
import { ErrorCode } from '../../common/exceptions/error-code';
import { GeneralException } from '../../common/exceptions/general.exception';
import { DebatesService } from '../debates.service';
import { debateRoomName, memberRoomName } from './debate-room-name.util';
import { DebateRoomService } from './debate-room.service';
import {
  DebateEventsPublisher,
  DebateRequestedPayload,
  DebateRequestRespondedPayload,
  TurnChangedPayload,
} from './debate-events-publisher.interface';
import {
  JoinDebateRoomDto,
  NextTurnDto,
  SendDebateMessageDto,
} from './dto/debate-socket.dto';

interface DebateSocketData {
  memberId: string;
}

// 게이트웨이는 파싱·인증·emit만 담당한다. 비즈니스 로직은 전부 DebateRoomService/DebatesService에 있다.
@WebSocketGateway({ cors: { origin: true } })
export class DebatesGateway
  implements OnGatewayInit, OnGatewayConnection, DebateEventsPublisher
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(DebatesGateway.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly debateRoomService: DebateRoomService,
    private readonly debatesService: DebatesService,
  ) {}

  // 서비스들이 브로드캐스트를 쓸 수 있도록 자신을 publisher로 등록하고(순환 DI 회피),
  // 핸드셰이크 인증 미들웨어를 붙인다.
  afterInit(server: Server): void {
    this.debateRoomService.bindPublisher(this);
    this.debatesService.bindPublisher(this);

    server.use((socket, next) => {
      const token = socket.handshake.auth?.jwt_token as string | undefined;
      try {
        if (!token) {
          throw new GeneralException(AuthErrorCode.UNAUTHORIZED);
        }
        const payload = this.tokenService.verifyAccessToken(token);
        (socket.data as DebateSocketData).memberId = payload.sub;
        next();
      } catch (error) {
        next(
          error instanceof Error ? error : new Error('인증에 실패했습니다.'),
        );
      }
    });
  }

  // 인증 미들웨어(afterInit) 이후 호출되므로 memberIdOf가 항상 값을 반환한다.
  // 개인 알림(debate_requested 등)을 이 회원에게만 보내기 위해 전용 room에 join시킨다.
  handleConnection(socket: Socket): void {
    void socket.join(memberRoomName(this.memberIdOf(socket)));
  }

  @SubscribeMessage('join_debate')
  async handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    try {
      const dto = await this.parse(JoinDebateRoomDto, body);
      const { socketRoom } = await this.debateRoomService.join(
        this.memberIdOf(socket),
        dto.debateId,
      );
      await socket.join(socketRoom);
    } catch (error) {
      this.emitError(socket, error);
    }
  }

  @SubscribeMessage('send_debate_message')
  async handleSendDebateMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    try {
      const dto = await this.parse(SendDebateMessageDto, body);
      const result = await this.debateRoomService.sendMessage(
        this.memberIdOf(socket),
        dto.debateId,
        dto.msg,
      );
      this.server
        .to(debateRoomName(dto.debateId))
        .emit('receive_debate_message', {
          senderId: result.senderId,
          senderNickname: result.senderNickname,
          debateMessageId: result.debateMessageId,
          msg: dto.msg,
        });
    } catch (error) {
      this.emitError(socket, error);
    }
  }

  @SubscribeMessage('next_turn')
  async handleNextTurn(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    try {
      const dto = await this.parse(NextTurnDto, body);
      await this.debateRoomService.nextTurn(
        this.memberIdOf(socket),
        dto.debateId,
      );
    } catch (error) {
      this.emitError(socket, error);
    }
  }

  // DebateEventsPublisher 구현: DebateRoomService/DebatesService가 이 인터페이스로만 게이트웨이를 안다.
  emitTurnChanged(socketRoom: string, payload: TurnChangedPayload): void {
    this.server.to(socketRoom).emit('debate_turn_changed', payload);
  }

  emitDebateRequested(
    opponentId: string,
    payload: DebateRequestedPayload,
  ): void {
    this.server
      .to(memberRoomName(opponentId))
      .emit('debate_requested', payload);
  }

  emitDebateRequestAccepted(
    hostId: string,
    payload: DebateRequestRespondedPayload,
  ): void {
    this.server
      .to(memberRoomName(hostId))
      .emit('debate_request_accepted', payload);
  }

  emitDebateRequestRejected(
    hostId: string,
    payload: DebateRequestRespondedPayload,
  ): void {
    this.server
      .to(memberRoomName(hostId))
      .emit('debate_request_rejected', payload);
  }

  private memberIdOf(socket: Socket): string {
    return (socket.data as DebateSocketData).memberId;
  }

  // payload를 DTO로 변환 후 class-validator로 검증한다. 실패 시 공통 INVALID_INPUT 에러로 던진다.
  private async parse<T extends object>(
    dtoClass: new () => T,
    body: unknown,
  ): Promise<T> {
    const instance = plainToInstance(dtoClass, body ?? {});
    const errors = await validate(instance as object);
    if (errors.length > 0) {
      throw new GeneralException(ErrorCode.INVALID_INPUT);
    }
    return instance;
  }

  // 모든 GeneralException(검증 실패 포함)은 해당 소켓에만 error_from_debate_room으로 알린다.
  private emitError(socket: Socket, error: unknown): void {
    if (error instanceof GeneralException) {
      socket.emit('error_from_debate_room', { msg: error.detail });
      return;
    }
    this.logger.error('예상하지 못한 토론방 소켓 오류', error as Error);
    socket.emit('error_from_debate_room', {
      msg: '알 수 없는 오류가 발생했습니다.',
    });
  }
}
