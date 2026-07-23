import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Community } from './community.entity';
import { Theme } from './theme.entity';

@Entity('community_theme')
@Unique(['communityId'])
export class CommunityTheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  themeId: string;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;

  @ManyToOne(() => Theme, { nullable: false })
  @JoinColumn({ name: 'theme_id' })
  theme: Theme;
}
