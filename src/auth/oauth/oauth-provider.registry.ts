import { Inject, Injectable } from '@nestjs/common';
import { GeneralException } from '../../common/exceptions/general.exception';
import { OAuthProviderType } from '../../members/members.enums';
import { AuthErrorCode } from '../exceptions/auth-error-code';
import { OAUTH_PROVIDERS, OAuthProvider } from './oauth-provider.interface';

@Injectable()
export class OAuthProviderRegistry {
  private readonly providers: ReadonlyMap<OAuthProviderType, OAuthProvider>;

  constructor(@Inject(OAUTH_PROVIDERS) providers: OAuthProvider[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );
  }

  // 공급자 종류에 맞는 구현체를 찾는다. 새 공급자는 모듈에 구현체를 등록하기만 하면 된다.
  resolve(provider: OAuthProviderType): OAuthProvider {
    const found = this.providers.get(provider);
    if (!found) {
      throw new GeneralException(AuthErrorCode.UNSUPPORTED_PROVIDER);
    }
    return found;
  }
}
