import { Test, TestingModule } from '@nestjs/testing';
import { GeneralException } from '../common/exceptions/general.exception';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { OAuthProviderType } from '../members/members.enums';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { AuthSessionService } from './auth-session.service';
import { AuthService } from './auth.service';
import { AuthTokenDto } from './dto/auth-token.dto';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { OAuthProfile } from './oauth/oauth-provider.interface';
import { OAuthProviderRegistry } from './oauth/oauth-provider.registry';
import { TokenService, TokenType } from './token.service';

describe('AuthService', () => {
  let service: AuthService;
  let provider: { provider: OAuthProviderType; verify: jest.Mock };
  let providerRegistry: { resolve: jest.Mock };
  let membersService: {
    findByOAuthAccount: jest.Mock;
    findByEmail: jest.Mock;
    linkOAuthAccount: jest.Mock;
    createWithOAuth: jest.Mock;
    findOneOrThrow: jest.Mock;
  };
  let tokenService: { verifyRefreshToken: jest.Mock };
  let authSessionService: {
    start: jest.Mock;
    rotate: jest.Mock;
    end: jest.Mock;
  };

  const authToken = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 1800,
  } as AuthTokenDto;

  const profile: OAuthProfile = {
    provider: OAuthProviderType.GOOGLE,
    providerId: 'google-sub-1',
    email: 'social@example.com',
    emailVerified: true,
    nickname: '소셜회원',
    profileImageUrl: 'https://cdn.example.com/profile/1.png',
  };

  const buildMember = (id: string, email: string): Member =>
    Object.assign(new Member(), {
      id,
      email,
      password: null,
      nickname: '소셜회원',
      gender: null,
      age: null,
      profileImageUrl: null,
      socialCredit: 0,
      rating: 0,
      status: ResourceStatus.NORMAL,
    });

  beforeEach(async () => {
    provider = {
      provider: OAuthProviderType.GOOGLE,
      verify: jest.fn().mockResolvedValue(profile),
    };
    providerRegistry = { resolve: jest.fn().mockReturnValue(provider) };

    membersService = {
      findByOAuthAccount: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      linkOAuthAccount: jest.fn().mockResolvedValue(undefined),
      createWithOAuth: jest.fn(),
      findOneOrThrow: jest.fn(),
    };

    tokenService = { verifyRefreshToken: jest.fn() };

    authSessionService = {
      start: jest.fn().mockResolvedValue(authToken),
      rotate: jest.fn().mockResolvedValue(authToken),
      end: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: OAuthProviderRegistry, useValue: providerRegistry },
        { provide: MembersService, useValue: membersService },
        { provide: TokenService, useValue: tokenService },
        { provide: AuthSessionService, useValue: authSessionService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('loginWithOAuth', () => {
    it('① 연동 이력이 있으면 그 회원으로 로그인하고 가입/연동을 시도하지 않는다', async () => {
      const linked = buildMember('linked-uuid', profile.email);
      membersService.findByOAuthAccount.mockResolvedValue(linked);

      const result = await service.loginWithOAuth(
        OAuthProviderType.GOOGLE,
        'id-token',
      );

      expect(provider.verify).toHaveBeenCalledWith('id-token');
      expect(membersService.findByOAuthAccount).toHaveBeenCalledWith(
        profile.provider,
        profile.providerId,
      );
      expect(membersService.findByEmail).not.toHaveBeenCalled();
      expect(membersService.linkOAuthAccount).not.toHaveBeenCalled();
      expect(membersService.createWithOAuth).not.toHaveBeenCalled();
      expect(authSessionService.start).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'linked-uuid' }),
      );
      expect(result).toBe(authToken);
    });

    it('③ 연동도 같은 이메일 회원도 없으면 자동 가입한다', async () => {
      const created = buildMember('new-uuid', profile.email);
      membersService.createWithOAuth.mockResolvedValue(created);

      const result = await service.loginWithOAuth(
        OAuthProviderType.GOOGLE,
        'id-token',
      );

      expect(membersService.createWithOAuth).toHaveBeenCalledWith({
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email,
        nickname: profile.nickname,
        profileImageUrl: profile.profileImageUrl,
      });
      expect(authSessionService.start).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'new-uuid' }),
      );
      expect(result).toBe(authToken);
    });

    it('② 검증된 이메일이 기존 회원과 같으면 자동 연동하고 그 회원으로 로그인한다', async () => {
      const existing = buildMember('existing-uuid', profile.email);
      membersService.findByEmail.mockResolvedValue(existing);

      await service.loginWithOAuth(OAuthProviderType.GOOGLE, 'id-token');

      expect(membersService.linkOAuthAccount).toHaveBeenCalledWith(
        'existing-uuid',
        {
          provider: profile.provider,
          providerId: profile.providerId,
          email: profile.email,
        },
      );
      expect(membersService.createWithOAuth).not.toHaveBeenCalled();
      expect(authSessionService.start).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'existing-uuid' }),
      );
    });

    it('② 미검증 이메일이면 자동 연동하지 않고 EMAIL_ALREADY_EXISTS 에러를 던진다', async () => {
      provider.verify.mockResolvedValue({ ...profile, emailVerified: false });
      membersService.findByEmail.mockResolvedValue(
        buildMember('existing-uuid', profile.email),
      );

      await expect(
        service.loginWithOAuth(OAuthProviderType.GOOGLE, 'id-token'),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.EMAIL_ALREADY_EXISTS,
      });

      expect(membersService.linkOAuthAccount).not.toHaveBeenCalled();
      expect(authSessionService.start).not.toHaveBeenCalled();
    });

    it('미검증 이메일이라도 기존 회원이 없으면 신규 가입은 허용한다', async () => {
      provider.verify.mockResolvedValue({ ...profile, emailVerified: false });
      membersService.createWithOAuth.mockResolvedValue(
        buildMember('new-uuid', profile.email),
      );

      await expect(
        service.loginWithOAuth(OAuthProviderType.GOOGLE, 'id-token'),
      ).resolves.toBe(authToken);
    });

    it('④ 공급자 검증이 실패하면 회원을 만들지 않고 그대로 전파한다', async () => {
      const error = new GeneralException(
        AuthErrorCode.OAUTH_VERIFICATION_FAILED,
      );
      provider.verify.mockRejectedValue(error);

      await expect(
        service.loginWithOAuth(OAuthProviderType.GOOGLE, 'bad-token'),
      ).rejects.toBe(error);

      expect(membersService.findByOAuthAccount).not.toHaveBeenCalled();
      expect(membersService.createWithOAuth).not.toHaveBeenCalled();
      expect(authSessionService.start).not.toHaveBeenCalled();
    });

    it('지원하지 않는 공급자면 레지스트리 에러가 그대로 전파된다', async () => {
      providerRegistry.resolve.mockImplementation(() => {
        throw new GeneralException(AuthErrorCode.UNSUPPORTED_PROVIDER);
      });

      await expect(
        service.loginWithOAuth(OAuthProviderType.GOOGLE, 'id-token'),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.UNSUPPORTED_PROVIDER,
      });
    });
  });

  describe('refresh', () => {
    it('토큰의 회원 상태를 확인한 뒤 회전 발급한다', async () => {
      const member = buildMember('member-uuid', profile.email);
      tokenService.verifyRefreshToken.mockReturnValue({
        sub: 'member-uuid',
        type: TokenType.REFRESH,
        jti: 'jti',
      });
      membersService.findOneOrThrow.mockResolvedValue(member);

      const result = await service.refresh('refresh-token');

      expect(membersService.findOneOrThrow).toHaveBeenCalledWith('member-uuid');
      expect(authSessionService.rotate).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'member-uuid' }),
        'refresh-token',
      );
      expect(result).toBe(authToken);
    });

    it('토큰 검증에 실패하면 회원을 조회하지 않는다', async () => {
      tokenService.verifyRefreshToken.mockImplementation(() => {
        throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
      });

      await expect(service.refresh('bad-token')).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });
      expect(membersService.findOneOrThrow).not.toHaveBeenCalled();
      expect(authSessionService.rotate).not.toHaveBeenCalled();
    });

    it('탈퇴한 회원의 토큰이면 회전하지 않는다', async () => {
      tokenService.verifyRefreshToken.mockReturnValue({
        sub: 'member-uuid',
        type: TokenType.REFRESH,
        jti: 'jti',
      });
      membersService.findOneOrThrow.mockRejectedValue(
        new GeneralException(MemberErrorCode.NOT_FOUND),
      );

      await expect(service.refresh('refresh-token')).rejects.toMatchObject({
        appError: MemberErrorCode.NOT_FOUND,
      });
      expect(authSessionService.rotate).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('제출된 리프레시 토큰으로 세션을 끝낸다', async () => {
      await service.logout('member-uuid', 'refresh-token');

      expect(authSessionService.end).toHaveBeenCalledWith(
        'member-uuid',
        'refresh-token',
      );
    });
  });
});
