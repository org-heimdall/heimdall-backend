import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';
import { Theme } from './theme.entity';

export enum CommunityState {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

@Entity('community')
export class Community extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  themeId: string;

  @Column({ type: 'enum', enum: CommunityState })
  state: CommunityState;

  @Column({ type: 'uuid' })
  hostId: string;

  @Column({ type: 'int' })
  memberCount: number;

  @Column({ type: 'varchar' })
  topic: string;

  @Column({ type: 'int' })
  debateRoundCount: number;

  @Column({ type: 'varchar', nullable: true })
  communityLink: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Theme, { nullable: false })
  @JoinColumn({ name: 'theme_id' })
  theme: Theme;

  // 커뮤니티 생성 시 초기 상태 불변식(대기중, 호스트 1명, 링크 없음)을 강제하는 팩토리
  static open(
    hostId: string,
    themeId: string,
    topic: string,
    debateRoundCount: number,
  ): Community {
    const community = new Community();
    community.state = CommunityState.WAITING;
    community.hostId = hostId;
    community.themeId = themeId;
    community.memberCount = 1;
    community.topic = topic;
    community.debateRoundCount = debateRoundCount;
    community.communityLink = null;
    return community;
  }
}
