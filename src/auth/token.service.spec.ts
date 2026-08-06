import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AppError } from '../common/exceptions/app-error.interface';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { JwtPayload, TokenService, TokenType } from './token.service';

/** expect.objectContaining의 반환 타입이 any라, toThrow 인자로 쓰려면 좁혀 준다 */
const throwsAppError = (appError: AppError): Error =>
  expect.objectContaining({ appError }) as Error;

const ACCESS_SECRET = 'access-secret-access-secret-access-secret';
const REFRESH_SECRET = 'refresh-secret-refresh-secret-refresh-secret';

const config: Record<string, string> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_ACCESS_EXPIRES_IN: '30m',
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN: '14d',
};

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;

  const memberId = 'member-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        TokenService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('issueAccessToken', () => {
    it('sub/type/jti만 담은 토큰을 발급한다', () => {
      const issued = service.issueAccessToken(memberId);
      const payload = jwtService.verify<JwtPayload>(issued.token, {
        secret: ACCESS_SECRET,
      });

      expect(payload.sub).toBe(memberId);
      expect(payload.type).toBe(TokenType.ACCESS);
      expect(payload.jti).toBe(issued.jti);
      // 프로필이 바뀌어도 토큰이 stale해지지 않도록 최소 클레임만 담는다.
      expect(Object.keys(payload).sort()).toEqual([
        'exp',
        'iat',
        'jti',
        'sub',
        'type',
      ]);
    });

    it('만료 시각(expiresAt)을 토큰의 exp와 일치시켜 반환한다', () => {
      const issued = service.issueAccessToken(memberId);
      const { exp } = jwtService.decode<{ exp: number }>(issued.token);

      expect(issued.expiresAt.getTime()).toBe(exp * 1000);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('발급할 때마다 다른 jti를 부여한다', () => {
      const first = service.issueAccessToken(memberId);
      const second = service.issueAccessToken(memberId);

      expect(first.jti).not.toBe(second.jti);
    });
  });

  describe('verifyAccessToken', () => {
    it('정상 토큰의 페이로드를 반환한다', () => {
      const issued = service.issueAccessToken(memberId);

      expect(service.verifyAccessToken(issued.token)).toMatchObject({
        sub: memberId,
        type: TokenType.ACCESS,
      });
    });

    it('만료된 토큰은 TOKEN_EXPIRED 에러를 던진다', () => {
      const expired = jwtService.sign(
        { sub: memberId, type: TokenType.ACCESS, jti: 'jti' },
        { secret: ACCESS_SECRET, expiresIn: '-1s' },
      );

      expect(() => service.verifyAccessToken(expired)).toThrow(
        throwsAppError(AuthErrorCode.TOKEN_EXPIRED),
      );
    });

    it('서명이 다른 토큰은 INVALID_TOKEN 에러를 던진다', () => {
      const forged = jwtService.sign(
        { sub: memberId, type: TokenType.ACCESS, jti: 'jti' },
        { secret: 'someone-elses-secret-someone-elses-secret' },
      );

      expect(() => service.verifyAccessToken(forged)).toThrow(
        throwsAppError(AuthErrorCode.INVALID_TOKEN),
      );
    });

    it('refresh 토큰을 access로 쓰면 거부한다(secret 분리)', () => {
      const refresh = service.issueRefreshToken(memberId);

      expect(() => service.verifyAccessToken(refresh.token)).toThrow(
        throwsAppError(AuthErrorCode.INVALID_TOKEN),
      );
    });

    it('secret이 맞아도 type이 다르면 거부한다', () => {
      // secret 설정이 잘못돼 두 종류가 같은 키로 서명되는 상황을 가정한 이중 방어 검증.
      const mistyped = jwtService.sign(
        { sub: memberId, type: TokenType.REFRESH, jti: 'jti' },
        { secret: ACCESS_SECRET },
      );

      expect(() => service.verifyAccessToken(mistyped)).toThrow(
        throwsAppError(AuthErrorCode.INVALID_TOKEN),
      );
    });
  });

  describe('verifyRefreshToken', () => {
    it('정상 토큰의 페이로드를 반환한다', () => {
      const issued = service.issueRefreshToken(memberId);

      expect(service.verifyRefreshToken(issued.token)).toMatchObject({
        sub: memberId,
        type: TokenType.REFRESH,
      });
    });

    it('access 토큰을 refresh로 쓰면 거부한다', () => {
      const access = service.issueAccessToken(memberId);

      expect(() => service.verifyRefreshToken(access.token)).toThrow(
        throwsAppError(AuthErrorCode.INVALID_REFRESH_TOKEN),
      );
    });

    it('만료돼도 재로그인 외에 길이 없으므로 INVALID_REFRESH_TOKEN으로 묶는다', () => {
      const expired = jwtService.sign(
        { sub: memberId, type: TokenType.REFRESH, jti: 'jti' },
        { secret: REFRESH_SECRET, expiresIn: '-1s' },
      );

      expect(() => service.verifyRefreshToken(expired)).toThrow(
        throwsAppError(AuthErrorCode.INVALID_REFRESH_TOKEN),
      );
    });
  });
});
