import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Community } from '../../communities/entities/community.entity';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

export enum DebateTurn {
  HOST = 'HOST',
  OPPONENT = 'OPPONENT',
}

@Entity('debate')
export class Debate extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  communityId: string;

  @Column({ type: 'uuid' })
  hostId: string;

  @Column({ type: 'varchar' })
  hostNickname: string;

  @Column({ type: 'uuid', nullable: true })
  opponentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  opponentNickname: string | null;

  @Column({ type: 'enum', enum: DebateTurn })
  currentTurn: DebateTurn;

  @Column({ type: 'int' })
  roundCount: number;

  @Column({ type: 'text', nullable: true })
  solution: string | null;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @ManyToOne(() => Community, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community: Community;
}
