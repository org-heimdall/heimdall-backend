import { DebatePhase, DebateSide } from '../../debates/debate-turn';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  ClaimType,
  DebateViolation,
  FactCheckSource,
  VerificationStatus,
} from '../judge.types';

export const ARGUMENT_ANALYZER = Symbol('ARGUMENT_ANALYZER');
export const FACT_CHECKER = Symbol('FACT_CHECKER');
export const DEBATE_JUDGE = Symbol('DEBATE_JUDGE');
export const JUDGE_SCORER = Symbol('JUDGE_SCORER');
export const JUDGE_COMMENTATOR = Symbol('JUDGE_COMMENTATOR');

// 시간 초과로 아무 말도 하지 않은 차례. 판정에는 "넘겼다"는 사실이 필요하다.
export const SILENT_TURN_PLACEHOLDER = '(발언 없음)';

/*
 * LLM 호출 로그에 싣는 단계별 도메인 컨텍스트. 프롬프트에는 들어가지 않고 LlmCallLogger로만 간다.
 * 필드 순서가 로그 출력 순서이므로 서비스는 아래 선언 순서대로 채운다.
 * (LlmLogContext에 대입하려면 index signature가 있어야 해서 interface가 아니라 type으로 둔다.)
 */

// Analyzer는 라운드 1개 단위라 turnIds에는 그 라운드의 비어 있지 않은 턴들이 발언 순서대로 들어간다.
export type AnalyzerLogContext = {
  debateId: string;
  turnIds: string[];
  phase: DebatePhase;
  round: number;
};

// FactCheck는 라운드당 Gemini 1회 호출이라 stage는 grounded_check 하나이고, targets에는 검증할 컴포넌트 id들이 들어간다.
export type FactCheckLogContext = {
  stage: 'grounded_check';
  debateId: string;
  phase: DebatePhase;
  round: number;
  targets: string[];
};

export type DebateJudgeLogContext = {
  debateId: string;
};

// ---------------------------------------------------------------- Argument Analyzer

export interface AnalyzerTurn {
  // 이번 요청 안에서만 쓰는 턴 별칭(t1, t2 …). 컴포넌트가 어느 턴에서 나왔는지 이 값으로 가리킨다.
  ref: string;
  sequence: number;
  speakerSide: DebateSide;
  speakerNickname: string;
  content: string;
}

// 분석할 라운드. 같은 (phase, round)의 비어 있지 않은 턴을 발언 순서대로 담는다.
export interface AnalyzerRound {
  phase: DebatePhase;
  round: number;
  turns: AnalyzerTurn[];
}

/**
 * 이전 라운드들에서 이미 뽑아 둔 컴포넌트. 이번 라운드의 반박·질의가 무엇을 겨냥하는지 잇기 위해 넣는다.
 * ref는 프롬프트 안에서만 쓰는 짧은 별칭이고, 실제 id는 서버가 갖고 있다.
 */
export interface AnalyzerKnownComponent {
  ref: string;
  speakerSide: DebateSide;
  kind: ArgumentComponentKind;
  statement: string;
  // 이미 사실 검증 대상이 된 조각의 검증 명제. 같은 주장을 다시 말했는지(duplicate_of_ref) 가리는 데 쓴다.
  factCheckStatement: string | null;
}

export interface AnalyzerRequest {
  topic: string;
  round: AnalyzerRound;
  previousComponents: AnalyzerKnownComponent[];
  logContext: AnalyzerLogContext;
}

export interface AnalyzedComponent {
  // 이번 응답 안에서만 유효한 별칭. 관계가 이 값으로 컴포넌트를 가리킨다.
  ref: string;
  // 이 조각이 나온 턴의 별칭(AnalyzerTurn.ref). 발언자·턴은 여기서 정해진다.
  turnRef: string;
  kind: ArgumentComponentKind;
  statement: string;
  claimType: ClaimType;
  // LLM이 외부 사실 확인을 요청했는지. 최종 대상 여부는 서버 정책(FactCheckTargetPolicy)이 정한다.
  needsFactCheck: boolean;
  // 검증할 원자적 명제(발언자·메타 표현 제거). needsFactCheck가 false면 null.
  factCheckStatement: string | null;
  // 이미 검증 대상이 된 조각(p… 또는 이번 라운드의 c…)과 같은 주장이면 그 별칭.
  duplicateOfRef: string | null;
}

export interface AnalyzedRelation {
  // 이번 라운드에서 새로 나온 컴포넌트여야 한다(관계를 만드는 쪽은 언제나 지금 말한 사람이다).
  fromRef: string;
  // 이번 라운드의 컴포넌트이거나 이전 라운드의 컴포넌트.
  toRef: string;
  kind: ArgumentRelationKind;
}

export interface AnalyzerResult {
  components: AnalyzedComponent[];
  relations: AnalyzedRelation[];
}

// 라운드 하나(확정 턴 묶음)에서 논증 그래프 조각을 뽑아내는 것.
export interface ArgumentAnalyzer {
  analyze(request: AnalyzerRequest): Promise<AnalyzerResult>;
}

// --------------------------------------------------------------- Fact Checker

// 검증할 명제 하나. ref는 이번 요청 안에서만 쓰는 별칭(f1, f2 …)이다.
export interface FactCheckTarget {
  ref: string;
  statement: string;
  claimType: ClaimType | null;
}

export interface FactCheckBatchRequest {
  topic: string;
  // 명제들이 나온 라운드의 발언 원문. 대명사·생략된 주어를 복원하는 데 쓴다.
  context: string;
  targets: FactCheckTarget[];
  logContext: FactCheckLogContext;
}

// 명제 하나에 대한 판정.
export interface FactCheckItemOutcome {
  ref: string;
  status: VerificationStatus;
  reason: string;
  sources: FactCheckSource[];
}

export interface FactCheckBatchOutcome {
  results: FactCheckItemOutcome[];
  /**
   * 실제로 검색이 일어났다는 근거(grounding 메타데이터의 출처 도메인). 한 번의 호출에서 나오므로 명제들이 공유한다.
   * Source Validator가 "모델이 검색 없이 지어낸 출처"를 걸러 내는 데 쓴다.
   */
  groundedDomains: string[];
}

// 여러 명제의 사실 여부를 한 번의 검색 근거 호출로 판정하는 것(bounded batch).
export interface FactChecker {
  checkBatch(request: FactCheckBatchRequest): Promise<FactCheckBatchOutcome>;
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
  logContext: DebateJudgeLogContext;
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

/*
 * 판정은 둘로 나뉜다. 점수·위반처럼 정해진 답 중에서 고르는 판단은 Scorer(Jev)가,
 * 그 판단을 사람이 읽을 문장으로 풀어 쓰는 일은 Commentator(LLM)가 맡는다.
 * DebateJudge 구현체(HybridDebateJudge)가 둘을 이어 기존 DebateJudgeResult를 그대로 만든다.
 */

// 편 하나의 점수·위반. 문장은 없다.
export type SideScoring = Omit<SideJudgment, 'feedback'>;

export interface DebateScoring {
  sideA: SideScoring;
  sideB: SideScoring;
  model: string;
}

export interface JudgeScorer {
  score(request: DebateJudgeRequest): Promise<DebateScoring>;
}

// 이미 정해진 점수를 함께 넘긴다. 문장이 점수와 어긋나지 않게 하기 위해서다.
export interface DebateCommentaryRequest extends DebateJudgeRequest {
  scoring: DebateScoring;
}

export interface DebateCommentary {
  sideAFeedback: string;
  sideBFeedback: string;
  overallReason: string;
  model: string;
}

export interface JudgeCommentator {
  comment(request: DebateCommentaryRequest): Promise<DebateCommentary>;
}
