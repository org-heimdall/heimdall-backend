import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DebateViolation, JudgmentWinner } from '../judge.types';

/**
 * 토론 1건의 최종 판정. 계약 JudgmentResult와 1:1이다.
 *
 * 편별 점수 세 개는 LLM이 매기고, 총점(가중합)과 승자는 서버가 계산해 넣는다
 * (내부 설계 "AI 처리 파이프라인" — Score Validator 뒤 서버 계산).
 */
@Entity('debate_judgment_result')
export class DebateJudgmentResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 토론당 판정은 하나뿐이다.
  @Column({ type: 'uuid', unique: true })
  debateId: string;

  @Column({ type: 'enum', enum: JudgmentWinner })
  winner: JudgmentWinner;

  @Column({ type: 'int' })
  sideAArgumentationScore: number;

  @Column({ type: 'int' })
  sideAInteractionScore: number;

  @Column({ type: 'int' })
  sideAFactualReliabilityScore: number;

  @Column({ type: 'int' })
  sideATotalScore: number;

  @Column({ type: 'int' })
  sideBArgumentationScore: number;

  @Column({ type: 'int' })
  sideBInteractionScore: number;

  @Column({ type: 'int' })
  sideBFactualReliabilityScore: number;

  @Column({ type: 'int' })
  sideBTotalScore: number;

  @Column({ type: 'text' })
  overallReason: string;

  @Column({ type: 'text' })
  sideAFeedback: string;

  @Column({ type: 'text' })
  sideBFeedback: string;

  /**
   * 위반 내역과 그로 인한 신뢰도 차감량. 계약 JudgmentResult에는 없는 필드라 프론트로 나가지 않고,
   * "왜 점수가 깎였는지"를 나중에 되짚기 위한 감사 기록으로만 남는다.
   */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  sideAViolations: DebateViolation[];

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  sideBViolations: DebateViolation[];

  @Column({ type: 'int', default: 0 })
  sideASocialCreditPenalty: number;

  @Column({ type: 'int', default: 0 })
  sideBSocialCreditPenalty: number;

  // 어떤 모델이 판정했는지(감사·재현용). 계약에는 나가지 않는다.
  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  judgedAt: Date;
}
