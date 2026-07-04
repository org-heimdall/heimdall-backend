import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('speech_like')
export class SpeechLike {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'member_id', type: 'bigint' })
  memberId: string;

  @Column({ name: 'speech_id', type: 'bigint' })
  speechId: string;

  @Column({ name: 'is_liked', type: 'boolean' })
  isLiked: boolean;
}
