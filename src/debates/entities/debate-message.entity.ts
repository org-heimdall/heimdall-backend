import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { Debate } from './debate.entity';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

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

  @Column({ type: 'int', nullable: true })
  debateTurn: number | null;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Debate, { nullable: false })
  @JoinColumn({ name: 'debate_id' })
  debate: Debate;
}
