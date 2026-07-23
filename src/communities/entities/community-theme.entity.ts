import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('community_theme')
@Unique(['communityId'])
export class CommunityTheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  themeId: string;
}
