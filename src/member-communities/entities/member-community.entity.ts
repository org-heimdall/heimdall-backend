import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('member_community')
@Unique(['memberId', 'communityId'])
export class MemberCommunity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'varchar', nullable: true })
  opinion: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  reasons: string[] | null;
}
