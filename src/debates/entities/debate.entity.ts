import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Community } from '../../communities/entities/community.entity';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';
import { DebateStatus } from './debate-status.enum';

export enum DebateTurn {
  HOST = 'HOST',
  OPPONENT = 'OPPONENT',
}

@Entity('debate')
export class Debate extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  hostId: string;

  @Column({ type: 'varchar' })
  hostNickname: string;

  @Column({ type: 'uuid', nullable: true })
  opponentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  opponentNickname: string | null;

  @Column({ type: 'enum', enum: DebateTurn })
  currentTurn: DebateTurn;

  // 토론 진행 단계(계약 DebateStatus). 아직 시작되지 않은 토론(시드 포함)은 null이며
  // READY와 같이 취급한다. 현재 차례(phase/round/side)는 확정 턴 수에서 파생되므로 저장하지 않는다.
  @Column({ type: 'enum', enum: DebateStatus, nullable: true })
  debateStatus: DebateStatus | null;

  // 토론이 시작된 시각. 첫 차례의 시간 초과 기준이며 확정 턴이 없으면 달리 알 수 없다.
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  // 토론이 끝난 시각(전원 발언 완료 또는 시간 초과).
  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  solution: object | null;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;
}
