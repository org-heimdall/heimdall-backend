import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthErrorCode } from '../../auth/exceptions/auth-error-code';
import { GeneralException } from '../exceptions/general.exception';
import { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * 전역 OptionalJwtAuthGuard가 채워 둔 request.user에서 현재 회원 id를 꺼낸다.
 * 가드는 토큰이 없으면 통과시키므로, 이 데코레이터를 쓰는 것이 곧 "인증 필수" 선언이다.
 */
export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!user) {
      throw new GeneralException(AuthErrorCode.UNAUTHORIZED);
    }

    return user.memberId;
  },
);
