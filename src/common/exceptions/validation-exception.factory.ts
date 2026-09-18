import { ValidationError } from '@nestjs/common';
import { ErrorCode } from './error-code';
import { GeneralException } from './general.exception';

// ValidationPipe의 exceptionFactory: 필드별 오류를 additionalInfo에 담아 변환
export function validationExceptionFactory(
  errors: ValidationError[],
): GeneralException {
  return new GeneralException(ErrorCode.INVALID_INPUT, {
    additionalInfo: flattenValidationErrors(errors),
  });
}

// 중첩 DTO의 children까지 "parent.child" 경로로 평탄화
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    if (error.constraints) {
      result[path] = Object.values(error.constraints)[0];
    }
    if (error.children?.length) {
      Object.assign(result, flattenValidationErrors(error.children, path));
    }
  }
  return result;
}
