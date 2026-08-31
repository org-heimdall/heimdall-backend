import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { Debate, DebateTurn } from './debate.entity';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

// 발언(메시지)이 기록될 수 있는 단계. PENDING(수락 전)·JUDGING·FINISHED에는 발언이 없다.
export type DebateMessageTurn = Exclude<
  DebateTurn,
  DebateTurn.PENDING | DebateTurn.JUDGING | DebateTurn.FINISHED
>;

// DB enum 정의와 런타임 판별에 쓰는 값 목록(DebateMessageTurn과 1:1로 유지).
export const DEBATE_MESSAGE_TURNS: readonly DebateMessageTurn[] = [
  DebateTurn.STARTING,
  DebateTurn.OPENING,
  DebateTurn.FREETALKING,
  DebateTurn.CLOSING,
];

export function isDebateMessageTurn(
  turn: DebateTurn,
): turn is DebateMessageTurn {
  return (DEBATE_MESSAGE_TURNS as readonly DebateTurn[]).includes(turn);
}

@Entity('debate_message')
export class DebateMessage extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  debateId: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  body: string | null;

  @Column({ type: 'enum', enum: DEBATE_MESSAGE_TURNS })
  debateTurn: DebateMessageTurn;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Debate, { nullable: false })
  @JoinColumn({ name: 'debate_id' })
  debate: Debate;
}
