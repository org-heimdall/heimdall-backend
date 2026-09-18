import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
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

  @Column({ type: 'boolean', default: false })
  isOnline: boolean;

  @Column({ type: 'varchar', nullable: true })
  opinion: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  reasons: string[] | null;

  // 계약의 CommunityOpinion.createdAt/updatedAt. updatedAt은 UPDATE 경로에서만 갱신되므로
  // 의견 수정은 upsert가 아니라 save()를 쓴다(member-communities.service.updateKeynote).
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;
}
