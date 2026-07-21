import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('community_favorite')
@Unique(['memberId', 'communityId'])
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
