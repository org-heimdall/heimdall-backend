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
export const DEBATE_SCORER = Symbol('DEBATE_SCORER');
export const DEBATE_COMMENTATOR = Symbol('DEBATE_COMMENTATOR');
export const VIOLATION_DETECTOR = Symbol('VIOLATION_DETECTOR');

// 시간 초과로 아무 말도 하지 않은 차례. 판정에는 "넘겼다"는 사실이 필요하다.
export const SILENT_TURN_PLACEHOLDER = '(발언 없음)';

/*
 * LLM 호출 로그에 싣는 단계별 도메인 컨텍스트. 프롬프트에는 들어가지 않고 LlmCallLogger로만 간다.
 * 필드 순서가 로그 출력 순서이므로 서비스는 아래 선언 순서대로 채운다.
 * (LlmLogContext에 대입하려면 index signature가 있어야 해서 interface가 아니라 type으로 둔다.)
 */

// Analyzer는 턴 1개 단위라 turnIds에는 하나만 들어간다. heimdall_ai와 형식을 맞추려고 배열로 둔다.
export type AnalyzerLogContext = {
  debateId: string;
  turnIds: string[];
  phase: DebatePhase;
  round: number;
};

// FactCheck는 Gemini 1회 호출이라 stage는 grounded_check 하나이고 targets에는 컴포넌트 id 1개가 들어간다.
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
  logContext: AnalyzerLogContext;
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
  logContext: FactCheckLogContext;
}

export interface FactCheckOutcome {
  status: VerificationStatus;
  reason: string;
  // url에는 원문 주소 대신 출처 도메인(예: news.naver.com)이 담긴다.
  sources: FactCheckSource[];
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
  logContext: DebateJudgeLogContext;
}

// 편 하나의 세 축 점수(0~100 정수). 총점은 서버가 가중합으로 계산한다.
export interface DebateSideScores {
  argumentationScore: number;
  interactionScore: number;
  factualReliabilityScore: number;
}

// 편 하나의 판정. 총점과 승자는 여기에 없다 — 서버가 계산한다.
export interface SideJudgment extends DebateSideScores {
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

// 점수·피드백·위반을 한데 모은 최종 판정. 판정 서비스는 이 포트만 안다.
export interface DebateJudge {
  judge(request: DebateJudgeRequest): Promise<DebateJudgeResult>;
}

// 편별 세 축 점수. model은 실제로 답한 모델의 버전 id다(별칭이 아니다).
export interface DebateScoreResult {
  sideA: DebateSideScores;
  sideB: DebateSideScores;
  model: string;
}

// 세 축 점수를 매기는 것. 피드백·위반은 만들지 않는다.
export interface DebateScorer {
  score(request: DebateJudgeRequest): Promise<DebateScoreResult>;
}

// 피드백은 이미 확정된 점수를 설명해야 하므로 점수를 함께 받는다.
export interface DebateCommentRequest extends DebateJudgeRequest {
  scores: { sideA: DebateSideScores; sideB: DebateSideScores };
}

export interface DebateCommentary {
  sideAFeedback: string;
  sideBFeedback: string;
  overallReason: string;
  model: string;
}

// 확정 점수에 대한 편별 피드백과 총평을 쓰는 것.
export interface DebateCommentator {
  comment(request: DebateCommentRequest): Promise<DebateCommentary>;
}

// 위반이 없는 편은 빈 배열이다.
export interface DebateViolationReport {
  sideA: DebateViolation[];
  sideB: DebateViolation[];
}

// 토론 규칙 위반(신뢰도 차감 근거)을 찾는 것.
export interface ViolationDetector {
  detectViolations(request: DebateJudgeRequest): Promise<DebateViolationReport>;
}
