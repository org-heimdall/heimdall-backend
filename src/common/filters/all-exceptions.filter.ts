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

    // RFC 9457: Problem Details 응답은 application/problem+json
    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}

const statusToCommonError: Record<number, AppError | undefined> = {
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_SERVER_ERROR,
};

// GeneralException이 아닌 HttpException의 status를 공통 에러 코드로 변환
function mapStatusToCommonError(status: number): AppError {
  return statusToCommonError[status] ?? fallbackHttpError(status);
}

// 카탈로그에 없는 status용 일반 오류 합성
function fallbackHttpError(status: number): AppError {
  return {
    httpStatus: status,
    code: 'COMMON.HTTP_ERROR',
    title: httpStatusTitle(status),
    detail:
      status >= 500
        ? '서버가 요청을 처리하지 못했습니다.'
        : '요청을 처리할 수 없습니다.',
  };
}

// HttpStatus enum 역조회 이름을 제목으로 변환 (예: PAYLOAD_TOO_LARGE → Payload Too Large)
function httpStatusTitle(status: number): string {
  const name: string | undefined = HttpStatus[status];
  if (!name) return 'HTTP Error';
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
