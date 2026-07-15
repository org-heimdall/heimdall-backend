import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { inspect } from 'node:util';
import { AppError } from '../exceptions/app-error.interface';
import { ErrorCode } from '../exceptions/error-code';
import { GeneralException } from '../exceptions/general.exception';
import { ProblemDetail } from '../exceptions/problem-detail.dto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  // 모든 예외를 ProblemDetail 형식의 응답으로 변환
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const instance = request.originalUrl ?? request.url;

    let problem: ProblemDetail;

    if (exception instanceof GeneralException) {
      problem = ProblemDetail.from(exception, instance);
      if (exception.cause) {
        this.logger.warn(
          `${exception.appError.code}: ${exception.detail}`,
          exception.cause instanceof Error
            ? exception.cause.stack
            : inspect(exception.cause),
        );
      }
    } else if (exception instanceof HttpException) {
      // Nest 기본/서드파티 예외(라우트 없음 404, 가드 401 등)를 공통 코드로 매핑
      const appError = mapStatusToCommonError(exception.getStatus());
      problem = ProblemDetail.of(appError, appError.detail, instance);
    } else {
      // 예상치 못한 오류: 클라이언트에는 일반 메시지만, 스택은 서버 로그에만 남김
      const appError = ErrorCode.INTERNAL_SERVER_ERROR;
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      problem = ProblemDetail.of(appError, appError.detail, instance);
    }

    response.status(problem.status).json(problem);
  }
}

const statusToCommonError: Record<number, AppError | undefined> = {
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
};

// GeneralException이 아닌 HttpException의 status를 공통 에러 코드로 변환
function mapStatusToCommonError(status: number): AppError {
  return (
    statusToCommonError[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_SERVER_ERROR : ErrorCode.INVALID_INPUT)
  );
}
