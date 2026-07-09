import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

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
}
