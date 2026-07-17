import { HttpException } from '@nestjs/common';
import { AppError } from './app-error.interface';

interface GeneralExceptionOptions {
  additionalInfo?: Record<string, string>; // 필드별 검증 오류 등 부가 정보
  cause?: unknown; // 감싸는 원인 예외 (서버 로그 전용, 응답에 노출되지 않음)
}

export class GeneralException extends HttpException {
  readonly appError: AppError;
  readonly detail: string;
  readonly additionalInfo?: Record<string, string>;

  constructor(appError: AppError, options: GeneralExceptionOptions = {}) {
    super(
      { errorCode: appError.code, detail: appError.detail },
      appError.httpStatus,
      { cause: options.cause },
    );

    this.appError = appError;
    this.detail = appError.detail;
    this.additionalInfo = options.additionalInfo;
  }
}
