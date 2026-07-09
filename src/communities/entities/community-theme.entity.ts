import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('community_theme')
export class CommunityTheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  themeId: string;
}
