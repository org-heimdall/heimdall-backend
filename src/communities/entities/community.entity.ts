import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum CommunityState {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

@Entity('community')
export class Community {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'enum', enum: CommunityState })
  state: CommunityState;

  @Column({ name: 'host_id', type: 'bigint' })
  hostId: string;

  @Column({ name: 'host_nickname', type: 'varchar' })
  hostNickname: string;

  @Column({ name: 'member_count', type: 'int' })
  memberCount: number;

  @Column({ type: 'varchar' })
  topic: string;

  @Column({ name: 'community_link', type: 'varchar', nullable: true })
  communityLink: string | null;
}
