import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { Community } from './community.entity';

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

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;
}
