import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('debate_speech')
export class DebateSpeech {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'member_id', type: 'bigint' })
  memberId: string;

  @Column({ name: 'debate_id', type: 'bigint' })
  debateId: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  body: string | null;

  /** 이미지 URL 목록 — ';' 구분 문자열로 저장 */
  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl: string | null;
}
