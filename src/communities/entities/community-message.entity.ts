import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('community_message')
export class CommunityMessage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'member_id', type: 'bigint' })
  memberId: string;

  @Column({ name: 'community_id', type: 'bigint' })
  communityId: string;

  @Column({ type: 'varchar', nullable: true })
  body: string | null;
}
