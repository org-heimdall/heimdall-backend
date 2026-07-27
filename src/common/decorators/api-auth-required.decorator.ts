import { applyDecorators } from '@nestjs/common';
import { AuthErrorCode } from '../../auth/exceptions/auth-error-code';
import { ApiErrorResponses } from '../exceptions/api-error-responses.decorator';

/**
 * @CurrentMember()를 쓰는 라우트의 "인증 필수"를 Swagger에 드러낸다.
 * 전역 가드가 옵셔널이라 401은 라우트 자체의 계약인데, 문서에 없으면
 * 프론트는 액세스 토큰이 필요한지조차 알 수 없다.
 */
export function ApiAuthRequired() {
  return applyDecorators(
    ApiErrorResponses(
      AuthErrorCode.UNAUTHORIZED,
      AuthErrorCode.INVALID_TOKEN,
      AuthErrorCode.TOKEN_EXPIRED,
    ),
  );
}
