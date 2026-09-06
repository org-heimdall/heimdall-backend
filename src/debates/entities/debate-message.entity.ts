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

// 토론 채팅이 확정한 턴은 (debate_id, sequence)로 유일하다. sequence가 null인 시드 행은
// 여러 개여도 되므로(Postgres는 null 중복을 허용) 부분 인덱스 없이 unique로 충분하다.
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
  debate_turn: number | null;

  @Column({ type: 'int', nullable: true })
  remaining_length: number | null;

  @Column({ type: 'int', nullable: true })
  remaining_images_count: number | null;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  // 토론 채팅이 확정한 턴의 순서(1부터). 시드 행은 null이며 채팅은 이 값이 있는 행만 확정 턴으로 읽는다.
  // 기존 debate_turn은 시드의 라운드 번호라 토론 안에서 유일하지 않아 대체할 수 없다.
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
