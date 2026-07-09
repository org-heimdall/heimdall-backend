import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('debate_speech')
export class DebateSpeech {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  debateId: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  body: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  imageUrl: string[] | null;
}
