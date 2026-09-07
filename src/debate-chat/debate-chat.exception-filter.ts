import {
  ArgumentsHost,
  Catch,
  Logger,
  WsExceptionFilter,
} from '@nestjs/common';
import { inspect } from 'node:util';
import { AppError } from '../common/exceptions/app-error.interface';
import { ErrorCode } from '../common/exceptions/error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { sendEvent } from './debate-chat.publisher';
import { DebateChatEvent, DebateChatErrorPayload } from './debate-chat.types';
import { DebateChatSocket } from './debate-chat.gateway';

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

// 명령 처리 중 예외를 계약의 error 이벤트 { debateId?, commandId?, code, message }로 요청 소켓에만 보낸다.
@Catch()
export class DebateChatExceptionFilter implements WsExceptionFilter {
  private readonly logger = new Logger(DebateChatExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToWs();
    const client = ctx.getClient<DebateChatSocket>();
    const command = ctx.getData<{ id?: unknown } | undefined>();
    const appError = toAppError(exception, this.logger);

    const payload: DebateChatErrorPayload = {
      debateId: client.debateId,
      commandId: typeof command?.id === 'string' ? command.id : undefined,
      code: appError.code,
      message: appError.detail,
    };
    sendEvent(client, { type: DebateChatEvent.ERROR, payload });
  }
}
