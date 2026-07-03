import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum DebateTurn {
  HOST = 'HOST',
  OPPONENT = 'OPPONENT',
}

@Entity('debate')
export class Debate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'community_id', type: 'bigint' })
  communityId: string;

  @Column({ name: 'host_id', type: 'bigint' })
  hostId: string;

  @Column({ name: 'host_nickname', type: 'varchar' })
  hostNickname: string;

  @Column({ name: 'opponent_id', type: 'bigint', nullable: true })
  opponentId: string | null;

  @Column({ name: 'opponent_nickname', type: 'varchar', nullable: true })
  opponentNickname: string | null;

  @Column({ name: 'current_turn', type: 'enum', enum: DebateTurn })
  currentTurn: DebateTurn;

  @Column({ name: 'round_count', type: 'int' })
  roundCount: number;

  @Column({ type: 'text', nullable: true })
  solution: string | null;

  @Column({ name: 'winner_id', type: 'bigint', nullable: true })
  winnerId: string | null;
}
