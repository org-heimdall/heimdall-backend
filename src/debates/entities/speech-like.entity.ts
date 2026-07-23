import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

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
}
