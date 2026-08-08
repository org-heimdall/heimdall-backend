import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { Community } from '../../communities/entities/community.entity';

@Entity('member_community')
@Unique(['memberId', 'communityId'])
export class MemberCommunity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'boolean' })
  isOnline: boolean;

  @Column({ type: 'varchar', nullable: true })
  opinion: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  reasons: string[] | null;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;
}
