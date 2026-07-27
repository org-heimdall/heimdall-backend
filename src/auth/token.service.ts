import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions, TokenExpiredError } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/exceptions/app-error.interface';
import { GeneralException } from '../common/exceptions/general.exception';
import { AuthErrorCode } from './exceptions/auth-error-code';

export enum TokenType {
  ACCESS = 'access',
  REFRESH = 'refresh',
}

/**
 * 페이로드는 최소화한다. nickname/email을 넣으면 프로필 수정 시 토큰이 stale해지고 크기만 커진다.
 */
export interface JwtPayload {
  sub: string; // memberId
  type: TokenType;
  jti: string;
}

export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

/** jsonwebtoken의 expiresIn은 '30m' 같은 ms 표기 템플릿 리터럴 타입이라 환경변수 문자열과 구분한다. */
type ExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

interface TokenSpec {
  secret: string;
  expiresIn: ExpiresIn;
}

interface VerificationErrors {
  expired: AppError;
  invalid: AppError;
}

@Injectable()
export class TokenService {
  private readonly specs: Record<TokenType, TokenSpec>;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.specs = {
      [TokenType.ACCESS]: {
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: configService.getOrThrow<ExpiresIn>('JWT_ACCESS_EXPIRES_IN'),
      },
      [TokenType.REFRESH]: {
        secret: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: configService.getOrThrow<ExpiresIn>(
          'JWT_REFRESH_EXPIRES_IN',
        ),
      },
    };
  }

  issueAccessToken(memberId: string): IssuedToken {
    return this.issue(memberId, TokenType.ACCESS);
  }

  issueRefreshToken(memberId: string): IssuedToken {
    return this.issue(memberId, TokenType.REFRESH);
  }

  // access 토큰 검증. 만료와 위조를 구분해 프론트가 "조용히 refresh"와 "즉시 로그아웃"으로 분기할 수 있게 한다.
  verifyAccessToken(token: string): JwtPayload {
    return this.verify(token, TokenType.ACCESS, {
      expired: AuthErrorCode.TOKEN_EXPIRED,
      invalid: AuthErrorCode.INVALID_TOKEN,
    });
  }

  // refresh 토큰 검증. 만료든 위조든 재로그인 외에 길이 없으므로 하나의 코드로 묶는다.
  verifyRefreshToken(token: string): JwtPayload {
    return this.verify(token, TokenType.REFRESH, {
      expired: AuthErrorCode.INVALID_REFRESH_TOKEN,
      invalid: AuthErrorCode.INVALID_REFRESH_TOKEN,
    });
  }

  private issue(memberId: string, type: TokenType): IssuedToken {
    const spec = this.specs[type];
    const jti = randomUUID();
    const payload: JwtPayload = { sub: memberId, type, jti };
    const token = this.jwtService.sign(payload, {
      secret: spec.secret,
      expiresIn: spec.expiresIn,
    });

    return { token, jti, expiresAt: this.readExpiresAt(token) };
  }

  private verify(
    token: string,
    expected: TokenType,
    errors: VerificationErrors,
  ): JwtPayload {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.specs[expected].secret,
      });
    } catch (error) {
      // 분류가 끝난 기대 가능한 실패이므로 cause를 붙이지 않는다(WARN 로그 방지).
      throw new GeneralException(
        error instanceof TokenExpiredError ? errors.expired : errors.invalid,
      );
    }

    // secret 분리만으로도 혼용은 막히지만, 페이로드로도 한 번 더 확인한다.
    if (payload.type !== expected) {
      throw new GeneralException(errors.invalid);
    }
    return payload;
  }

  // 서명된 토큰의 exp(초 단위)를 Date로 환산한다. expiresIn 문자열 파싱을 직접 하지 않기 위함.
  private readExpiresAt(token: string): Date {
    const { exp } = this.jwtService.decode<{ exp: number }>(token);
    return new Date(exp * 1000);
  }
}
