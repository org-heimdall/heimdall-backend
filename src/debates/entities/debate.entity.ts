import {
  Column,
  CreateDateColumn,
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

  // 토론 주제. 생성 시 커뮤니티 값을 복사한다 — 진행 중인 토론의 주제가
  // 커뮤니티 설정 변경으로 흔들리면 안 되기 때문이다.
  @Column({ type: 'varchar', length: 500 })
  topic: string;

  // 반론·질의 라운드 수(턴 스케줄의 N). 생성 시 community.debateRoundCount를 복사한다.
  // 이 값이 없으면 발언 순서(DebateTurnSchedule)를 만들 수 없어 nullable로 두지 않는다.
  @Column({ type: 'int' })
  rebuttalQuestionRounds: number;

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

  /**
   * 토론 전체가 늦어도 끝나는 시각 = startedAt + (차례 수 × 턴 제한 시간). 시작할 때 기록만 하고
   * 강제하지 않는다. 아무도 발언하지 않아도 차례가 제한 시간 간격으로 넘어가므로
   * 토론은 정확히 이 시각에 스스로 끝난다.
   */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  // 판정(JUDGING)이 시작된 시각. Judge 작업이 만들어질 때 함께 기록한다(작업 항목 ⑥).
  @Column({ type: 'timestamptz', nullable: true })
  judgingStartedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;
}
