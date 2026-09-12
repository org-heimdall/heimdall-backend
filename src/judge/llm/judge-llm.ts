import { DebatePhase, DebateSide } from '../../debates/debate-turn';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  DebateViolation,
  FactCheckSource,
  VerificationStatus,
} from '../judge.types';

export const ARGUMENT_ANALYZER = Symbol('ARGUMENT_ANALYZER');
export const FACT_CHECKER = Symbol('FACT_CHECKER');
export const DEBATE_JUDGE = Symbol('DEBATE_JUDGE');

// 시간 초과로 아무 말도 하지 않은 차례. 판정에는 "넘겼다"는 사실이 필요하다.
export const SILENT_TURN_PLACEHOLDER = '(발언 없음)';

// ---------------------------------------------------------------- Argument Analyzer

export interface AnalyzerTurn {
  sequence: number;
  phase: DebatePhase;
  round: number;
  speakerSide: DebateSide;
  speakerNickname: string;
  content: string;
}

/**
 * 이전 턴들에서 이미 뽑아 둔 컴포넌트. 이번 턴의 반박·질의가 무엇을 겨냥하는지 잇기 위해 넣는다.
 * ref는 프롬프트 안에서만 쓰는 짧은 별칭이고, 실제 id는 서버가 갖고 있다.
 */
export interface AnalyzerKnownComponent {
  ref: string;
  speakerSide: DebateSide;
  kind: ArgumentComponentKind;
  statement: string;
}

export interface AnalyzerRequest {
  topic: string;
  turn: AnalyzerTurn;
  previousComponents: AnalyzerKnownComponent[];
}

export interface AnalyzedComponent {
  // 이번 응답 안에서만 유효한 별칭. 관계가 이 값으로 컴포넌트를 가리킨다.
  ref: string;
  kind: ArgumentComponentKind;
  statement: string;
  // 외부 사실 확인이 필요한 주장인지. true인 것마다 FactCheck 작업이 하나 생긴다.
  needsFactCheck: boolean;
}

export interface AnalyzedRelation {
  // 이번 턴에서 새로 나온 컴포넌트여야 한다(관계를 만드는 쪽은 언제나 지금 말한 사람이다).
  fromRef: string;
  // 이번 턴의 컴포넌트이거나 이전 턴의 컴포넌트.
  toRef: string;
  kind: ArgumentRelationKind;
}

export interface AnalyzerResult {
  components: AnalyzedComponent[];
  relations: AnalyzedRelation[];
}

// 확정 턴 하나에서 논증 그래프 조각을 뽑아내는 것.
export interface ArgumentAnalyzer {
  analyze(request: AnalyzerRequest): Promise<AnalyzerResult>;
}

// --------------------------------------------------------------- Fact Checker

export interface FactCheckRequest {
  topic: string;
  // 검증할 문장(Analyzer가 뽑은 컴포넌트).
  statement: string;
  // 발언이 나온 맥락. 대명사·생략된 주어를 복원하는 데 쓴다.
  context: string;
}

export interface FactCheckOutcome {
  status: VerificationStatus;
  reason: string;
  sources: FactCheckSource[];
  /**
   * 실제로 검색이 일어났다는 근거(grounding 메타데이터의 출처 도메인).
   * Source Validator가 "모델이 검색 없이 지어낸 출처"를 걸러 내는 데 쓴다.
   */
  groundedDomains: string[];
}

// 문장 하나의 사실 여부를 외부 검색 근거와 함께 판정하는 것.
export interface FactChecker {
  check(request: FactCheckRequest): Promise<FactCheckOutcome>;
}

// ------------------------------------------------------------------- Debate Judge

export interface JudgeTranscriptTurn {
  sequence: number;
  phase: DebatePhase;
  round: number;
  speakerSide: DebateSide;
  speakerNickname: string;
  content: string;
}

// 논증 그래프 조각 + 그 문장의 사실 검증 결과(있을 때만).
export interface JudgeComponentSummary {
  // 프롬프트 안에서만 쓰는 짧은 별칭(#1, #2 …). 관계가 이 값으로 컴포넌트를 가리킨다.
  ref: string;
  speakerSide: DebateSide;
  kind: ArgumentComponentKind;
  statement: string;
  factCheck: { status: VerificationStatus; reason: string } | null;
}

/**
 * 컴포넌트 사이의 관계. 상호작용 점수는 "상대 주장을 실제로 겨냥했는가"를 보는 것이므로
 * 마디만으로는 매길 수 없다 — 간선이 그 근거다.
 */
export interface JudgeRelationSummary {
  fromRef: string;
  toRef: string;
  kind: ArgumentRelationKind;
}

export interface DebateJudgeRequest {
  topic: string;
  sideANickname: string;
  sideBNickname: string;
  turns: JudgeTranscriptTurn[];
  components: JudgeComponentSummary[];
  relations: JudgeRelationSummary[];
}

// 편 하나의 판정. 총점과 승자는 여기에 없다 — 서버가 계산한다.
export interface SideJudgment {
  argumentationScore: number;
  interactionScore: number;
  factualReliabilityScore: number;
  feedback: string;
  // 신뢰도 차감의 근거. 위반이 없으면 빈 배열이다.
  violations: DebateViolation[];
}

export interface DebateJudgeResult {
  sideA: SideJudgment;
  sideB: SideJudgment;
  overallReason: string;
  model: string;
}

export interface DebateJudge {
  judge(request: DebateJudgeRequest): Promise<DebateJudgeResult>;
}
