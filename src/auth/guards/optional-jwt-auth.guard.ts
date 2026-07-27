import { ExecutionContext, Injectable } from '@nestjs/common';
import { TokenExpiredError } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { GeneralException } from '../../common/exceptions/general.exception';
import { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AuthErrorCode } from '../exceptions/auth-error-code';

/**
 * APP_GUARD로 전역 등록되는 옵셔널 인증 가드.
 * 토큰이 있으면 검증해 request.user를 채우고, 없으면 비인증으로 통과시킨다.
 * "이 라우트에 인증이 필요한가"는 @CurrentMember() 사용 여부가 결정한다.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(
    err: unknown,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 토큰 미첨부: request.user를 비운 채 통과. 공개 라우트는 그대로 동작한다.
    if (!request.headers.authorization) {
      return undefined as TUser;
    }

    // 토큰이 왔는데 깨졌으면 여기서 401. 조용히 익명으로 강등하면
    // @CurrentMember() 라우트에서 인증 문제와 무관해 보이는 에러를 받게 된다.
    if (err || !user) {
      throw new GeneralException(
        info instanceof TokenExpiredError
          ? AuthErrorCode.TOKEN_EXPIRED
          : AuthErrorCode.INVALID_TOKEN,
      );
    }

    return user;
  }
}
