import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Community } from '../../communities/entities/community.entity';
import { ResourceStatus } from '../../common/entities/resource-status.enum';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

export enum DebateTurn {
  PENDING = 'PENDING',
  STARTING = 'STARTING', // 토론자 결정 직후
  OPENING = 'OPENING', // 입론
  FREETALKING = 'FREETALKING', // 자유 발언
  CLOSING = 'CLOSING', // 최종 변론
  JUDGING = 'JUDGING',
  FINISHED = 'FINISHED',
}

/**
 * (community, host)당 PENDING 요청은 하나만 존재할 수 있는 부분 유니크 인덱스 이름.
 * 자동 생성 이름(IDX_<해시>)은 코드에서 참조할 수 없어 명시적으로 부여한다.
 * 서비스가 unique 위반을 이 이름으로 분류해 동시 요청 레이스를 REQUEST_ALREADY_PENDING으로 처리한다.
 */
export const DEBATE_PENDING_REQUEST_UNIQUE = 'UQ_debate_community_host_pending';

@Entity('debate')
@Index(DEBATE_PENDING_REQUEST_UNIQUE, ['communityId', 'hostId'], {
  unique: true,
  where: '"current_turn" = \'PENDING\'',
})
export class Debate extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  hostId: string;

  @Column({ type: 'varchar' })
  hostNickname: string;

  @Column({ type: 'uuid' })
  opponentId: string;

  @Column({ type: 'varchar' })
  opponentNickname: string;

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

  // PENDING 요청 슬롯 재사용 시 UPDATE에 쓸 리셋 값. 닉네임 스냅샷은 이전 요청 이후
  // 변경됐을 수 있어 둘 다 갱신하고, 나머지는 open()과 동일한 초기 불변식으로 되돌린다.
  static reopenRequestValues(
    hostNickname: string,
    opponentId: string,
    opponentNickname: string,
  ) {
    return {
      hostNickname,
      opponentId,
      opponentNickname,
      currentTurn: DebateTurn.PENDING,
      currentSpeakerId: null,
      freetalkingRound: 0,
      winnerId: null,
      solution: null,
      status: ResourceStatus.NORMAL,
    };
  }
}
