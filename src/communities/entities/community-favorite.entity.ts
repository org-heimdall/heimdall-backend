import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('community_favorite')
export class CommunityFavorite {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'member_id', type: 'bigint' })
  memberId: string;

  @Column({ name: 'community_id', type: 'bigint' })
  communityId: string;

  @Column({ name: 'is_favored', type: 'boolean' })
  isFavored: boolean;
}
