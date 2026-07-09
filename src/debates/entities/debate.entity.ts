import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum DebateTurn {
  HOST = 'HOST',
  OPPONENT = 'OPPONENT',
}

@Entity('debate')
export class Debate {
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
}
