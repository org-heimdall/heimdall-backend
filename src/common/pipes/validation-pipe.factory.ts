import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../exceptions/validation-exception.factory';

// HTTP(main.ts)와 WS 게이트웨이가 같은 검증 규칙을 쓰도록 한곳에서 만든다.
// DTO에 없는 속성은 400(forbidNonWhitelisted), 오류는 ProblemDetail 형식으로 변환한다.
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
