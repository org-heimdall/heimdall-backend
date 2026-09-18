import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DebateInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

/**
 * 대기 중 초대의 부분 유니크 인덱스 이름. 자동 생성 이름은 코드에서 참조할 수 없어 명시적으로 부여한다.
 * 서비스가 unique 위반을 이 이름으로 분류한다.
 */
export const DEBATE_INVITATION_PENDING_UNIQUE = 'UQ_debate_invitation_pending';

/**
 * 방장이 보낸 토론 초대. 수명이 몇 초뿐이지만 accept/reject/expire가 동시에 올 수 있어
 * 상태 전이를 DB가 한 번만 허용해야 하고, 재시작 뒤 만료도 복구해야 해서 행으로 남긴다.
 * 사용자가 지우는 리소스가 아니므로 SoftDeletableEntity를 상속하지 않는다.
 */
@Entity('debate_invitation')
// 커뮤니티당 대기 중 초대는 하나뿐이다. 부분 유니크 인덱스가 동시 start를 DB에서 걸러 낸다.
@Index(DEBATE_INVITATION_PENDING_UNIQUE, ['communityId'], {
  unique: true,
  where: `status = '${DebateInvitationStatus.PENDING}'`,
})
export class DebateInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  hostMemberId: string;

  @Column({ type: 'uuid' })
  opponentMemberId: string;

  @Column({
    type: 'enum',
    enum: DebateInvitationStatus,
    default: DebateInvitationStatus.PENDING,
  })
  status: DebateInvitationStatus = DebateInvitationStatus.PENDING;

  // 응답 마감 시각. 프론트의 5초 카운트다운은 UI일 뿐이고 만료 판정의 기준은 이 값이다.
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  // 수락·거절·만료가 확정된 시각(대기 중이면 null).
  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  // 수락으로 만들어진 토론. 초대와 토론을 잇는 유일한 연결이다.
  @Column({ type: 'uuid', nullable: true })
  debateId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // 초대 발행 불변식(대기 중, 마감 = 지금 + TTL, 미응답)을 강제하는 팩토리
  static issue(params: {
    communityId: string;
    hostMemberId: string;
    opponentMemberId: string;
    ttlSeconds: number;
    now: Date;
  }): DebateInvitation {
    const invitation = new DebateInvitation();
    invitation.communityId = params.communityId;
    invitation.hostMemberId = params.hostMemberId;
    invitation.opponentMemberId = params.opponentMemberId;
    invitation.status = DebateInvitationStatus.PENDING;
    invitation.expiresAt = new Date(
      params.now.getTime() + params.ttlSeconds * 1000,
    );
    invitation.respondedAt = null;
    invitation.debateId = null;
    return invitation;
  }

  // 유예 없이 마감 시각만으로 판정한다(프론트가 5초 UI 타이머를 쓰고 판정은 백엔드 기준이라는 계약).
  isExpired(now: Date): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }
}
