import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('speech_like')
export class SpeechLike {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  speechId: string;

  @Column({ type: 'boolean' })
  isLiked: boolean;
}
