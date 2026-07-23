import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CommunityState {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

@Entity('community')
export class Community {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: CommunityState })
  state: CommunityState;

  @Column({ type: 'uuid' })
  hostId: string;

  @Column({ type: 'varchar' })
  hostNickname: string;

  @Column({ type: 'int' })
  memberCount: number;

  @Column({ type: 'varchar' })
  topic: string;

  @Column({ type: 'varchar', nullable: true })
  communityLink: string | null;

  @CreateDateColumn()
  createdAt: Date;

  // 커뮤니티 생성 시 초기 상태 불변식(대기중, 호스트 1명, 링크 없음)을 강제하는 팩토리
  static open(hostId: string, hostNickname: string, topic: string): Community {
    const community = new Community();
    community.state = CommunityState.WAITING;
    community.hostId = hostId;
    community.hostNickname = hostNickname;
    community.memberCount = 1;
    community.topic = topic;
    community.communityLink = null;
    return community;
  }
}
