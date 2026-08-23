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

export enum DebateTurn {
  PENDING = 'PENDING',
  STARTING = 'STARTING',
  OPENING = 'OPENING',
  FREETALKING = 'FREETALKING',
  CLOSING = 'CLOSING',
  JUDGING = 'JUDGING',
  FINISHED = 'FINISHED',
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

  @Column({ type: 'enum', enum: DebateTurn, default: DebateTurn.PENDING })
  currentTurn: DebateTurn;

  @Column({ type: 'uuid', nullable: true })
  currentSpeakerId: string | null;

  // 자유발언 단계 진행 왕복 수 (host→opponent 한 번 오가면 1 증가)
  @Column({ type: 'int', default: 0 })
  freetalkingRound: number;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ type: 'text', nullable: true })
  solution: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;

  // 토론 요청 생성 시 초기 상태 불변식(PENDING, 발언자·라운드·승자 없음)을 강제하는 팩토리.
  // 상대가 수락해야 STARTING으로 전환된다(accept 참고).
  static open(params: {
    communityId: string;
    hostId: string;
    hostNickname: string;
    opponentId: string;
    opponentNickname: string;
  }): Debate {
    const debate = new Debate();
    debate.communityId = params.communityId;
    debate.hostId = params.hostId;
    debate.hostNickname = params.hostNickname;
    debate.opponentId = params.opponentId;
    debate.opponentNickname = params.opponentNickname;
    debate.currentTurn = DebateTurn.PENDING;
    debate.currentSpeakerId = null;
    debate.freetalkingRound = 0;
    debate.winnerId = null;
    debate.solution = null;
    return debate;
  }
}
