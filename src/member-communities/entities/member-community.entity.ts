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

// 계약(frontend-api-contract.md)의 CommunityDebateIntent. 커뮤니티 안에서만 의미가 있는 값이라
// 회원이 아니라 참여 행이 갖는다.
export enum CommunityDebateIntent {
  OPEN_TO_DEBATE = 'OPEN_TO_DEBATE',
  PREPARING = 'PREPARING',
}

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

  /**
   * 토론 의사. 참여 직후에는 준비 중이며, 본인이 PUT …/members/me/debate-intent로 바꾼다.
   * 방장은 OPEN_TO_DEBATE인 참여자만 토론에 초대할 수 있다.
   * DB default는 INSERT 시점에만 적용되므로, 저장 전 in-memory 행도 같은 값을 갖도록 초기값을 둔다.
   */
  @Column({
    type: 'enum',
    enum: CommunityDebateIntent,
    default: CommunityDebateIntent.PREPARING,
  })
  debateIntent: CommunityDebateIntent = CommunityDebateIntent.PREPARING;

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
