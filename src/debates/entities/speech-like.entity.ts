import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { DebateSpeech } from './debate-speech.entity';

@Entity('speech_like')
@Unique(['memberId', 'speechId'])
export class SpeechLike {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  speechId: string;

  @Column({ type: 'boolean' })
  isLiked: boolean;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => DebateSpeech, { nullable: false })
  @JoinColumn({ name: 'speech_id' })
  speech: DebateSpeech;
}
