import { Test, TestingModule } from '@nestjs/testing';
import { MemberDto } from '../members/dto/member.dto';
import { AuthSessionService } from './auth-session.service';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { RefreshTokenService } from './refresh-token.service';
import { IssuedToken, TokenService } from './token.service';

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let tokenService: {
    issueAccessToken: jest.Mock;
    issueRefreshToken: jest.Mock;
  };
  let refreshTokenService: {
    persist: jest.Mock;
    rotate: jest.Mock;
    revoke: jest.Mock;
  };

  const member: MemberDto = {
    memberId: 'member-uuid',
    email: 'heimdall@example.com',
    nickname: '헤임달',
    gender: null,
    age: null,
    profileImageUrl: null,
    socialCredit: 0,
    rating: 0,
  };

  const access: IssuedToken = {
    token: 'access-token',
    jti: 'access-jti',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
  const refresh: IssuedToken = {
    token: 'refresh-token',
    jti: 'refresh-jti',
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  };

  beforeEach(async () => {
    tokenService = {
      issueAccessToken: jest.fn().mockReturnValue(access),
      issueRefreshToken: jest.fn().mockReturnValue(refresh),
    };
    refreshTokenService = {
      persist: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSessionService,
        { provide: TokenService, useValue: tokenService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = module.get<AuthSessionService>(AuthSessionService);
  });

  describe('start', () => {
    it('토큰 쌍을 발급하고 리프레시 토큰만 저장한다', async () => {
      const result = await service.start(member);

      expect(refreshTokenService.persist).toHaveBeenCalledWith(
        member.memberId,
        refresh,
      );
      expect(result.accessToken).toBe(access.token);
      expect(result.refreshToken).toBe(refresh.token);
      expect(result.member).toBe(member);
    });

    it('expiresIn을 access 토큰 만료까지 남은 초로 계산한다', async () => {
      const result = await service.start(member);

      // 30분 = 1800초. 테스트 실행 시간 오차를 감안해 근사 비교한다.
      expect(result.expiresIn).toBeGreaterThan(1790);
      expect(result.expiresIn).toBeLessThanOrEqual(1800);
    });

    it('이미 만료된 토큰이어도 expiresIn을 음수로 내보내지 않는다', async () => {
      tokenService.issueAccessToken.mockReturnValue({
        ...access,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.start(member)).resolves.toMatchObject({
        expiresIn: 0,
      });
    });
  });

  describe('rotate', () => {
    it('새 토큰 쌍을 발급하고 제출된 토큰과 함께 회전을 요청한다', async () => {
      const result = await service.rotate(member, 'presented-token');

      expect(refreshTokenService.rotate).toHaveBeenCalledWith(
        member.memberId,
        'presented-token',
        refresh,
      );
      expect(result.refreshToken).toBe(refresh.token);
    });

    it('회전이 거부되면 새 토큰을 반환하지 않는다', async () => {
      refreshTokenService.rotate.mockRejectedValue(
        new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN),
      );

      await expect(
        service.rotate(member, 'reused-token'),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });
    });
  });

  describe('end', () => {
    it('제출된 리프레시 토큰을 폐기한다', async () => {
      await service.end(member.memberId, 'refresh-token');

      expect(refreshTokenService.revoke).toHaveBeenCalledWith(
        member.memberId,
        'refresh-token',
      );
    });
  });
});
