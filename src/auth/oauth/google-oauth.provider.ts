import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { GeneralException } from '../../common/exceptions/general.exception';
import { OAuthProviderType } from '../../members/members.enums';
import { AuthErrorCode } from '../exceptions/auth-error-code';
import { OAuthProfile, OAuthProvider } from './oauth-provider.interface';

@Injectable()
export class GoogleOAuthProvider implements OAuthProvider {
  readonly provider = OAuthProviderType.GOOGLE;

  private readonly clientId: string;
  private readonly client: OAuth2Client;

  constructor(configService: ConfigService) {
    this.clientId = configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.client = new OAuth2Client(this.clientId);
  }

  // 구글 ID token을 검증한다(서명 · aud · iss · exp는 라이브러리가 확인).
  async verify(idToken: string): Promise<OAuthProfile> {
    const payload = await this.verifyIdToken(idToken);

    // 이메일은 회원 식별·자동 연동의 근거라 없으면 진행할 수 없다.
    if (!payload.email) {
      throw new GeneralException(AuthErrorCode.OAUTH_VERIFICATION_FAILED);
    }

    return {
      provider: this.provider,
      providerId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      nickname: payload.name ?? payload.email.split('@')[0],
      profileImageUrl: payload.picture ?? null,
    };
  }

  private async verifyIdToken(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('id token payload가 비어 있습니다.');
      }
      return payload;
    } catch (error) {
      // 라이브러리가 만료·서명 불일치·네트워크 실패를 구분 없이 Error로 던져
      // 도메인 사실로 완전히 환원할 수 없다. 원인을 cause로 남겨 서버 로그에서 추적한다.
      throw new GeneralException(AuthErrorCode.OAUTH_VERIFICATION_FAILED, {
        cause: error,
      });
    }
  }
}
