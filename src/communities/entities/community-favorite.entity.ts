import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('community_favorite')
export class CommunityFavorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'boolean' })
  isFavored: boolean;
}
