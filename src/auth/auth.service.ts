import { Injectable } from '@nestjs/common';
import { GeneralException } from '../common/exceptions/general.exception';
import { MemberDto } from '../members/dto/member.dto';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { OAuthProviderType } from '../members/members.enums';
import { AuthSessionService } from './auth-session.service';
import { AuthTokenDto } from './dto/auth-token.dto';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { OAuthProfile } from './oauth/oauth-provider.interface';
import { OAuthProviderRegistry } from './oauth/oauth-provider.registry';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly membersService: MembersService,
    private readonly tokenService: TokenService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  // 소셜 자격증명을 검증해 회원을 해결(연동/가입)하고 자체 토큰을 발급한다.
  async loginWithOAuth(
    providerType: OAuthProviderType,
    credential: string,
  ): Promise<AuthTokenDto> {
    const provider = this.providerRegistry.resolve(providerType);
    const profile = await provider.verify(credential);
    const member = await this.resolveMember(profile);

    return this.authSessionService.start(MemberDto.from(member));
  }

  // 리프레시 토큰을 회전해 새 토큰 쌍을 발급한다.
  async refresh(refreshToken: string): Promise<AuthTokenDto> {
    const { sub: memberId } =
      this.tokenService.verifyRefreshToken(refreshToken);

    // access 토큰은 매 요청 DB를 보지 않으므로, 탈퇴/차단 회원 차단은 이 시점에 한다.
    const member = await this.membersService.findOneOrThrow(memberId);

    return this.authSessionService.rotate(MemberDto.from(member), refreshToken);
  }

  // 로그아웃: 제출된 리프레시 토큰을 폐기한다.
  async logout(memberId: string, refreshToken: string): Promise<void> {
    await this.authSessionService.end(memberId, refreshToken);
  }

  /**
   * ① 연동 이력이 있으면 그 회원, ② 같은 이메일의 기존 회원이 있으면 자동 연동,
   * ③ 둘 다 없으면 신규 가입 순으로 회원을 해결한다.
   */
  private async resolveMember(profile: OAuthProfile): Promise<Member> {
    const linked = await this.membersService.findByOAuthAccount(
      profile.provider,
      profile.providerId,
    );
    if (linked) {
      return linked;
    }

    const sameEmail = await this.membersService.findByEmail(profile.email);
    if (sameEmail) {
      // 미검증 이메일을 신뢰하면 남의 이메일을 등록한 소셜 계정으로 기존 회원을 탈취할 수 있다.
      if (!profile.emailVerified) {
        throw new GeneralException(AuthErrorCode.EMAIL_ALREADY_EXISTS);
      }

      await this.membersService.linkOAuthAccount(sameEmail.id, {
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email,
      });
      return sameEmail;
    }

    return this.membersService.createWithOAuth({
      provider: profile.provider,
      providerId: profile.providerId,
      email: profile.email,
      nickname: profile.nickname,
      profileImageUrl: profile.profileImageUrl,
    });
  }
}
