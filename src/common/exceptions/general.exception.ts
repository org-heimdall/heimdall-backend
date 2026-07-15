import { HttpException } from '@nestjs/common';
import { AppError } from './app-error.interface';

interface GeneralExceptionOptions {
  args?: unknown[]; // detail의 %s 치환 인자
  additionalInfo?: Record<string, string>; // 필드별 검증 오류 등 부가 정보
  cause?: unknown; // 감싸는 원인 예외 (서버 로그 전용, 응답에 노출되지 않음)
}

export class GeneralException extends HttpException {
  readonly appError: AppError;
  readonly detail: string;
  readonly additionalInfo?: Record<string, string>;

  constructor(appError: AppError, options: GeneralExceptionOptions = {}) {
    const detail = formatDetail(appError.detail, options.args ?? []);

    super({ errorCode: appError.code, detail }, appError.httpStatus, {
      cause: options.cause,
    });

    this.appError = appError;
    this.detail = detail;
    this.additionalInfo = options.additionalInfo;
  }
}

// detail 템플릿의 %s를 순서대로 args 값으로 치환
function formatDetail(template: string, args: unknown[]): string {
  if (args.length === 0) return template;
  let i = 0;
  return template.replace(/%s/g, (match) =>
    i < args.length ? String(args[i++]) : match,
  );
}
