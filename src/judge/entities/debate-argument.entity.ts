import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DebateSide } from '../../debates/debate-turn';
import { ArgumentComponentKind, ArgumentRelationKind } from '../judge.types';

// 논증 그래프. 컴포넌트(마디)와 관계(간선)는 언제나 함께 쓰이고 함께 교체되므로 한 파일에 둔다.

// Analyzer가 확정 턴 하나에서 뽑아낸 논증 조각. 계약 FactCheckResult.componentId가 이 id다.
@Index(['debateId', 'turnId'])
@Entity('debate_argument_component')
export class DebateArgumentComponent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  debateId: string;

  // 이 조각이 나온 확정 턴(debate_message.id).
  @Column({ type: 'uuid' })
  turnId: string;

  // 발언 순서. 프롬프트에 이전 턴 컴포넌트를 순서대로 넣고 결과를 정렬하는 데 쓴다.
  @Column({ type: 'int' })
  turnSequence: number;

  @Column({ type: 'uuid' })
  speakerId: string;

  @Column({ type: 'enum', enum: DebateSide })
  speakerSide: DebateSide;

  @Column({ type: 'enum', enum: ArgumentComponentKind })
  kind: ArgumentComponentKind;

  @Column({ type: 'text' })
  statement: string;

  // 사실 검증이 필요한 조각인지. true인 조각마다 FactCheck 작업이 하나 생긴다.
  @Column({ type: 'boolean', default: false })
  needsFactCheck: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

// 컴포넌트 사이의 관계(from이 to에 대해 하는 행위). Judge의 상호작용 점수 근거가 된다.
@Index(['debateId'])
@Entity('debate_argument_relation')
export class DebateArgumentRelation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  debateId: string;

  @Column({ type: 'uuid' })
  fromComponentId: string;

  @Column({ type: 'uuid' })
  toComponentId: string;

  @Column({ type: 'enum', enum: ArgumentRelationKind })
  kind: ArgumentRelationKind;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
