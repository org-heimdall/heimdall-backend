import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { Debate } from './debate.entity';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

// 확정된 턴은 (debate_id, sequence)로 유일하다.
@Index(['debateId', 'sequence'], { unique: true })
@Entity('debate_message')
export class DebateMessage extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  debateId: string;

  // 확정 턴 한 건은 DEBATE_TURN_MAX_TOTAL_CHARACTERS(기본 1500자)까지 커질 수 있어
  // 길이 제한을 두지 않는다.
  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'int', nullable: true })
  remaining_images_count: number | null;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  // 토론 안에서 이 턴이 확정된 순서(1부터). 발언 순서는 이 값 하나로만 나타내며,
  // phase·round·발언한 편은 이 값과 토론 스케줄에서 파생한다.
  @Column({ type: 'int', nullable: true })
  sequence: number | null;

  // 계약 DebateChatTurn.createdAt이자 다음 차례의 시간 초과 기준 시각.
  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Debate, { nullable: false })
  @JoinColumn({ name: 'debate_id' })
  debate: Debate;
}
