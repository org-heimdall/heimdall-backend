import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('community_theme')
export class CommunityTheme {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'community_id', type: 'bigint' })
  communityId: string;

  @Column({ name: 'theme_id', type: 'bigint' })
  themeId: string;
}
