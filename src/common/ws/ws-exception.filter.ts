import { ArgumentsHost, Logger, WsExceptionFilter } from '@nestjs/common';
import { inspect } from 'node:util';
import { WebSocket } from 'ws';
import { AppError } from '../exceptions/app-error.interface';
import { ErrorCode } from '../exceptions/error-code';
import { GeneralException } from '../exceptions/general.exception';
import { sendEvent, wsEvent } from './ws-event';

// 계약의 모든 채팅 게이트웨이가 쓰는 오류 이벤트 이름.
export const WS_ERROR_EVENT = 'error';

// error 이벤트에 싣는 값. 방 식별자(debateId/communityId)는 게이트웨이마다 달라 scopeOf가 붙인다.
export interface WsErrorPayload {
  commandId?: string;
  code: string;
  message: string;
}

// 예외를 WS error 이벤트에 쓸 AppError로 환원한다.
// AllExceptionsFilter(HTTP)와 같은 정책: 카탈로그 예외는 그대로, cause는 WARN, 예상 밖 예외는 500 + ERROR 로그.
export function toAppError(error: unknown, logger: Logger): AppError {
  if (error instanceof GeneralException) {
    if (error.cause) {
      logger.warn(
        `${error.appError.code}: ${error.detail}`,
        error.cause instanceof Error ? error.cause.stack : inspect(error.cause),
      );
    }
    return error.appError;
  }
  logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
  );
  return ErrorCode.INTERNAL_SERVER_ERROR;
}

/**
 * 명령 처리 중 예외를 계약의 error 이벤트 { <scope>?, commandId?, code, message }로 요청 소켓에만 보낸다.
 * 게이트웨이마다 다른 것은 함께 실리는 방 식별자뿐이라 그 부분만 서브클래스가 채운다.
 * 서브클래스에는 @Catch()를 직접 달아야 한다(필터 메타데이터는 구현 클래스에서 읽힌다).
 */
export abstract class WsCommandExceptionFilter<
  TClient extends WebSocket = WebSocket,
> implements WsExceptionFilter {
  protected readonly logger = new Logger(this.constructor.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToWs();
    const client = ctx.getClient<TClient>();
    const command = ctx.getData<{ id?: unknown } | undefined>();
    const appError = toAppError(exception, this.logger);

    const payload: WsErrorPayload = {
      ...this.scopeOf(client),
      commandId: typeof command?.id === 'string' ? command.id : undefined,
      code: appError.code,
      message: appError.detail,
    };
    // 오류는 같은 내용으로 여러 번 날 수 있어 id를 파생하지 않는다(매번 다른 이벤트다).
    sendEvent(client, wsEvent(WS_ERROR_EVENT, payload));
  }

  // error 이벤트 앞에 붙는 방 식별자(예: { debateId }, { communityId }).
  protected abstract scopeOf(
    client: TClient,
  ): Record<string, string | undefined>;
}
