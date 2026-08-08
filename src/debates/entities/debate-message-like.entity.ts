import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { DebateMessage } from './debate-message.entity';

@Entity('debate_message_like')
@Unique(['memberId', 'messageId'])
export class DebateMessageLike {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  messageId: string;

  @Column({ type: 'boolean' })
  isLiked: boolean;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => DebateMessage, { nullable: false })
  @JoinColumn({ name: 'message_id' })
  debate_message: DebateMessage;
}
