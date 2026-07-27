import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { GeneralException } from '../common/exceptions/general.exception';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { IssuedToken } from './token.service';

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  // 발급된 refresh 토큰의 해시를 저장한다(로그인 직후).
  async persist(memberId: string, issued: IssuedToken): Promise<RefreshToken> {
    return this.refreshTokenRepository.save(this.toEntity(memberId, issued));
  }

  /**
   * 제출된 토큰을 검증하고 회전한다. 새 토큰 저장과 이전 토큰 폐기는 한 트랜잭션으로 묶어
   * 중간 실패로 두 토큰이 동시에 유효해지거나 세션이 통째로 사라지는 상태를 만들지 않는다.
   */
  async rotate(
    memberId: string,
    presentedToken: string,
    next: IssuedToken,
  ): Promise<void> {
    const current = await this.findRotatableOrThrow(memberId, presentedToken);

    await this.refreshTokenRepository.manager.transaction(async (manager) => {
      const issued = await manager.save(this.toEntity(memberId, next));
      current.revoke(new Date(), issued.id);
      await manager.save(current);
    });
  }

  // 로그아웃: 제출된 토큰을 폐기한다. 이미 없거나 폐기된 토큰이어도 로그아웃은 성공으로 둔다(멱등).
  async revoke(memberId: string, token: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { memberId, tokenHash: this.hash(token), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  // 탈취 정황 발견 시 회원의 모든 활성 토큰을 끊는다.
  async revokeAllForMember(memberId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { memberId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  // 회전 가능한(존재 · 본인 소유 · 미폐기 · 미만료) 토큰을 찾는다.
  private async findRotatableOrThrow(
    memberId: string,
    token: string,
  ): Promise<RefreshToken> {
    const stored = await this.refreshTokenRepository.findOneBy({
      tokenHash: this.hash(token),
    });

    // 미등록 토큰과 남의 토큰은 구분하지 않는다(정보 노출 방지).
    if (!stored || stored.memberId !== memberId) {
      throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
    }

    // 이미 회전·폐기된 토큰의 재제출은 탈취로 간주한다. 정상 클라이언트는 폐기된 토큰을 다시 쓰지 않는다.
    // 공격자와 피해자 중 누가 제출한 것인지 알 수 없으므로 회원의 세션을 전부 끊고 재로그인을 강제한다.
    if (stored.revokedAt !== null) {
      await this.revokeAllForMember(memberId);
      throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
    }

    if (!stored.isActive(new Date())) {
      throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
    }

    return stored;
  }

  private toEntity(memberId: string, issued: IssuedToken): RefreshToken {
    return RefreshToken.issue({
      memberId,
      tokenHash: this.hash(issued.token),
      expiresAt: issued.expiresAt,
    });
  }

  // 토큰 원문 대신 해시를 저장·조회한다. 토큰은 고엔트로피 랜덤값이라 salt 없는 sha256으로 충분하다.
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
