import { Injectable } from '@nestjs/common';
import { MemberDto } from '../members/dto/member.dto';
import { AuthTokenDto } from './dto/auth-token.dto';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  // 새 세션을 시작한다(로그인 성공 직후).
  async start(member: MemberDto): Promise<AuthTokenDto> {
    const access = this.tokenService.issueAccessToken(member.memberId);
    const refresh = this.tokenService.issueRefreshToken(member.memberId);
    await this.refreshTokenService.persist(member.memberId, refresh);

    return AuthTokenDto.of(access, refresh, member);
  }

  // 리프레시 토큰을 회전해 세션을 이어간다.
  async rotate(
    member: MemberDto,
    presentedRefreshToken: string,
  ): Promise<AuthTokenDto> {
    const access = this.tokenService.issueAccessToken(member.memberId);
    const refresh = this.tokenService.issueRefreshToken(member.memberId);

    // 회전이 거부되면(재사용 감지 등) 방금 서명한 토큰은 저장되지 않은 채 버려진다.
    await this.refreshTokenService.rotate(
      member.memberId,
      presentedRefreshToken,
      refresh,
    );

    return AuthTokenDto.of(access, refresh, member);
  }

  // 세션을 끝낸다. access 토큰은 만료까지 유효하므로 클라이언트도 폐기해야 한다.
  async end(memberId: string, refreshToken: string): Promise<void> {
    await this.refreshTokenService.revoke(memberId, refreshToken);
  }
}
