import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Raw, Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { GeneralException } from '../common/exceptions/general.exception';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { IssuedToken } from './token.service';

// 폐기 시각은 앱이 아니라 DB 시계로 남긴다. 앱 인스턴스마다 시계가 어긋나도 기준이 하나로 유지된다.
const NOW = (): string => 'NOW()';

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

    const rotated = await this.refreshTokenRepository.manager.transaction(
      async (manager) => {
        // 새 토큰 id를 미리 정해 두면 폐기 UPDATE 한 번으로 대체 이력까지 남길 수 있다.
        const issued = this.toEntity(memberId, next);
        issued.id = randomUUID();

        // 회전 가능 조건(미폐기 · 미만료)을 UPDATE의 WHERE로 다시 건다. 같은 토큰이 동시에
        // 들어와도 1행을 갱신하는 쪽은 하나뿐이므로, 검증 시점과 폐기 시점 사이의 경합에서
        // 진 요청은 0행을 받는다. 만료 판정 기준은 앱 서버가 아니라 DB 시계다(인스턴스 간 시계 오차 무관).
        const revoked = await manager.update(
          RefreshToken,
          {
            id: current.id,
            revokedAt: IsNull(),
            expiresAt: Raw((column) => `${column} > NOW()`),
          },
          { revokedAt: NOW, replacedById: issued.id },
        );
        if (!revoked.affected) return false;

        // 새 토큰은 이전 토큰 폐기에 성공한 뒤에만 발급한다.
        await manager.insert(RefreshToken, issued);
        return true;
      },
    );

    // 트랜잭션 밖에서 처리한다. 안에서 하면 방금 잠근 행을 같은 회원 범위로 다시 갱신하게 된다.
    if (!rotated) await this.rejectFailedRotation(memberId, presentedToken);
  }

  // 로그아웃: 제출된 토큰을 폐기한다. 이미 없거나 폐기된 토큰이어도 로그아웃은 성공으로 둔다(멱등).
  async revoke(memberId: string, token: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { memberId, tokenHash: this.hash(token), revokedAt: IsNull() },
      { revokedAt: NOW },
    );
  }

  // 탈취 정황 발견 시 회원의 모든 활성 토큰을 끊는다.
  async revokeAllForMember(memberId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { memberId, revokedAt: IsNull() },
      { revokedAt: NOW },
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

    if (stored.revokedAt !== null) {
      await this.rejectAsReuse(memberId);
    }

    if (!stored.isActive(new Date())) {
      throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
    }

    return stored;
  }

  // 조건부 폐기가 0행이면 검증 직후 상태가 바뀐 것이다(동시 회전 · 만료 · 삭제).
  // 재사용만 전 세션을 끊는 정책이므로 원인을 다시 읽어 분류한다. 실패 경로에서만 도는 추가 조회다.
  private async rejectFailedRotation(
    memberId: string,
    token: string,
  ): Promise<never> {
    await this.findRotatableOrThrow(memberId, token);

    // 여기까지 오면 재조회 시점엔 다시 회전 가능해 보인다는 뜻이지만, 폐기에 실패한 이상 회전은 거부한다.
    throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
  }

  // 이미 회전·폐기된 토큰의 재제출은 탈취로 간주한다. 정상 클라이언트는 폐기된 토큰을 다시 쓰지 않는다.
  // 공격자와 피해자 중 누가 제출한 것인지 알 수 없으므로 회원의 세션을 전부 끊고 재로그인을 강제한다.
  private async rejectAsReuse(memberId: string): Promise<never> {
    await this.revokeAllForMember(memberId);
    throw new GeneralException(AuthErrorCode.INVALID_REFRESH_TOKEN);
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
