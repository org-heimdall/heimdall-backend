import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedMember } from '../../common/types/authenticated-request';
import { JwtPayload, TokenType } from '../token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * 서명·만료 검증은 passport-jwt가 끝냈다. 여기서는 페이로드를 request.user 형태로 옮기기만 하는
   * 얇은 계층으로 유지한다(매 요청 DB 조회 없음 — 회원 상태 확인은 refresh 시점에만).
   */
  validate(payload: JwtPayload): AuthenticatedMember | null {
    // refresh 토큰은 secret이 달라 여기까지 오지 않지만, 페이로드로도 한 번 더 막는다.
    if (payload.type !== TokenType.ACCESS) {
      return null;
    }
    return { memberId: payload.sub };
  }
}
