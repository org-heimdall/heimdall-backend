import { OAuthProviderType } from '../../members/members.enums';

/**
 * 공급자별 응답을 정규화한 프로필. AuthService/MembersService는 이 형태만 알면 되므로
 * 카카오/네이버가 추가돼도 아래 계층은 바뀌지 않는다.
 */
export interface OAuthProfile {
  provider: OAuthProviderType;
  providerId: string; // 공급자 내 고유 식별자(구글은 sub)
  email: string;
  emailVerified: boolean; // 미검증 이메일로는 기존 계정에 자동 연동하지 않는다
  nickname: string;
  profileImageUrl: string | null;
}

/**
 * 소셜 로그인 자격증명 검증기. 구현체를 추가하고 레지스트리에 등록하면
 * AuthService는 수정 없이 새 공급자를 지원한다(OCP).
 */
export interface OAuthProvider {
  readonly provider: OAuthProviderType;
  verify(credential: string): Promise<OAuthProfile>;
}

/** OAuthProvider 구현체 목록 주입 토큰 */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
