import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('community_message')
export class CommunityMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'varchar', nullable: true })
  body: string | null;
}
