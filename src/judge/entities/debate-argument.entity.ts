import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DebateSide } from '../../debates/debate-turn';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  ClaimType,
  FactCheckExclusionReason,
} from '../judge.types';

/**
 * 검증 대상 주장의 중복 방지 인덱스 이름. 동시에 돈 두 분석이 같은 주장을 둘 다 검증 대상으로 만들면
 * 이 인덱스가 막고, 분석기는 이 이름으로 위반을 알아보고 재시도한다(다음 시도에서 중복으로 분류된다).
 */
export const ARGUMENT_COMPONENT_CLAIM_HASH_UNIQUE =
  'UQ_argument_component_claim_hash';

// 논증 그래프. 컴포넌트(마디)와 관계(간선)는 언제나 함께 쓰이고 함께 교체되므로 한 파일에 둔다.

// Analyzer가 확정 턴 하나에서 뽑아낸 논증 조각. 계약 FactCheckResult.componentId가 이 id다.
@Index(['debateId', 'turnId'])
@Index(ARGUMENT_COMPONENT_CLAIM_HASH_UNIQUE, ['debateId', 'claimHash'], {
  unique: true,
  where: '"needs_fact_check" = true',
})
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

  // 사실 검증 대상인지. LLM의 요청을 서버 정책(FactCheckTargetPolicy)이 거른 최종 결정이다.
  @Column({ type: 'boolean', default: false })
  needsFactCheck: boolean;

  // 주장 유형. 이 컬럼이 생기기 전에 분석된 행은 null이다.
  @Column({ type: 'enum', enum: ClaimType, nullable: true })
  claimType: ClaimType | null;

  /**
   * 검증할 원자적 명제. statement는 논증 요약이라 "~라고 주장한다" 같은 표현이 섞일 수 있어,
   * 사실 검증과 결과 카드에는 발언자·메타 표현을 뺀 이 문장을 쓴다. 레거시 행은 null(statement로 대신한다).
   */
  @Column({ type: 'text', nullable: true })
  factCheckStatement: string | null;

  // 정규화한 검증 명제의 sha256 hex. 같은 토론에서 같은 주장을 두 번 검증하지 않게 하는 키다.
  @Column({ type: 'varchar', length: 64, nullable: true })
  claimHash: string | null;

  // LLM은 검증을 요청했지만 서버 정책이 뺀 이유. 요청하지 않았거나 대상이 된 조각은 null.
  @Column({ type: 'enum', enum: FactCheckExclusionReason, nullable: true })
  factCheckExclusionReason: FactCheckExclusionReason | null;

  // 같은 주장을 먼저 해 검증 대상이 된 조각. 관계 테이블처럼 재분석 교체를 견디도록 FK는 걸지 않는다.
  @Column({ type: 'uuid', nullable: true })
  duplicateOfComponentId: string | null;

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
