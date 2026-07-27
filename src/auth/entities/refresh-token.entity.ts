import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// memberId는 ID 참조로 둔다(엔티티는 소유 도메인에만 — AGENTS.md).
@Entity('refresh_token')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  memberId: string;

  // 토큰 원문은 저장하지 않는다. DB가 유출돼도 그 자체로는 토큰으로 쓸 수 없다.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  // 회전으로 이 토큰을 대체한 새 토큰. 재사용 감지 시 체인 추적에 쓴다.
  @Column({ type: 'uuid', nullable: true })
  replacedById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  // 발급 시 불변식(미폐기 · 대체 이력 없음)을 강제하는 팩토리
  static issue(params: {
    memberId: string;
    tokenHash: string;
    expiresAt: Date;
  }): RefreshToken {
    const token = new RefreshToken();
    token.memberId = params.memberId;
    token.tokenHash = params.tokenHash;
    token.expiresAt = params.expiresAt;
    token.revokedAt = null;
    token.replacedById = null;
    return token;
  }

  // 폐기되지 않았고 아직 만료되지 않은 토큰인지
  isActive(now: Date): boolean {
    return this.revokedAt === null && this.expiresAt.getTime() > now.getTime();
  }
}
