import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FactCheckSource, VerificationStatus } from '../judge.types';
import { DebateArgumentComponent } from './debate-argument.entity';

// 컴포넌트 1건의 검증 결과. 컴포넌트당 한 행이며 계약 FactCheckResult로 직렬화된다.
@Index(['debateId'])
@Entity('debate_fact_check_result')
export class DebateFactCheckResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  debateId: string;

  @Column({ type: 'uuid', unique: true })
  componentId: string;

  @Column({ type: 'enum', enum: VerificationStatus })
  status: VerificationStatus;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  checkedAt: Date;

  /**
   * Source Validator를 통과한 근거 출처. 결과와 수명이 완전히 같고(결과를 갈아 끼우면 함께 바뀐다)
   * 출처 단위로 조회할 일이 없어 별도 테이블 대신 jsonb로 둔다.
   */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  sources: FactCheckSource[];

  // 컴포넌트가 재분석으로 교체되면 그 문장에 대한 검증도 의미를 잃으므로 함께 사라진다.
  @ManyToOne(() => DebateArgumentComponent, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'component_id' })
  component: DebateArgumentComponent;
}
