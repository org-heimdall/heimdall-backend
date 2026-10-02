// 파이프라인 내부 열거형과 계약(frontend-api-contract.md) 열거형. 계약 쪽 값을 바꾸면 프론트 mapper가 깨진다.

// 비동기 작업의 종류. 대상(targetId)은 종류마다 다르다 — JudgeTask 참고.
export enum JudgeTaskKind {
  ANALYZER = 'ANALYZER',
  FACT_CHECK = 'FACT_CHECK',
  JUDGE = 'JUDGE',
}

// backend-internal-design.md의 "AI worker 상태" 다이어그램과 1:1이다.
export enum JudgeTaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// Analyzer가 턴에서 뽑아내는 논증 조각. 계약 FactCheckResult.componentId가 이 중 하나를 가리킨다.
export enum ArgumentComponentKind {
  CLAIM = 'CLAIM',
  EVIDENCE = 'EVIDENCE',
  QUESTION = 'QUESTION',
  REBUTTAL = 'REBUTTAL',
}

// 컴포넌트 사이의 관계. from이 to에 대해 하는 행위다.
export enum ArgumentRelationKind {
  SUPPORT = 'SUPPORT',
  ATTACK = 'ATTACK',
  QUESTION = 'QUESTION',
}

// 컴포넌트 문장의 주장 유형. Analyzer가 붙이고, 앞의 다섯 개만 외부 자료로 검증할 수 있다.
export enum ClaimType {
  STATISTIC = 'STATISTIC', // 수치·통계·여론조사·인원·규모
  CITED_SOURCE = 'CITED_SOURCE', // 특정 보고서·연구·기관 발표를 근거로 제시
  DATE_EVENT = 'DATE_EVENT', // 날짜, 특정 사건의 발생 여부
  LAW_INSTITUTION = 'LAW_INSTITUTION', // 법률·조약·제도·기관의 공식 입장
  HISTORICAL_SCIENTIFIC = 'HISTORICAL_SCIENTIFIC', // 역사·과학적 사실
  PREDICTION = 'PREDICTION', // 전망·가정·조건부 추론
  NORMATIVE = 'NORMATIVE', // 규범·가치판단·정책 제안
  META = 'META', // 상대 주장 평가, 발언자 조언, 출처 요구, 논증 연결
  OPINION = 'OPINION', // 그 밖의 일반 주장
}

// LLM이 사실 검증을 요청했지만 서버 정책이 대상에서 뺀 이유. 감사·튜닝용으로만 남는다.
export enum FactCheckExclusionReason {
  NON_FACTUAL = 'NON_FACTUAL', // 유형 또는 문장 형태가 예측·규범·의견
  META_STATEMENT = 'META_STATEMENT', // 발언자·조언·평가 같은 메타 문장
  DUPLICATE = 'DUPLICATE', // 이미 검증 대상인 주장과 같음
  OVER_LIMIT = 'OVER_LIMIT', // 상한 초과(우선순위에서 밀림)
}

// 계약 VerificationStatus.
export enum VerificationStatus {
  SUPPORTED = 'SUPPORTED',
  CONTRADICTED = 'CONTRADICTED',
  PARTIALLY_SUPPORTED = 'PARTIALLY_SUPPORTED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
  NOT_VERIFIABLE = 'NOT_VERIFIABLE',
  OUTDATED = 'OUTDATED',
}

// 계약 JudgmentWinner.
export enum JudgmentWinner {
  SIDE_A = 'SIDE_A',
  SIDE_B = 'SIDE_B',
  DRAW = 'DRAW',
}

/**
 * 사실 검증의 근거 출처. 계약 FactCheckSource와 1:1이며 검증 결과 행의 jsonb 컬럼에 그대로 담긴다.
 * 출처만 따로 조회하거나 집계할 일이 없어 테이블로 나누지 않았다.
 */
export interface FactCheckSource {
  title: string;
  publisher: string;
  url: string;
}

/**
 * 토론 중 위반 행위. 삭제된 구 judge 모듈에서 이관했다.
 * 계약 JudgmentResult에는 위반 필드가 없어 프론트로 나가지 않고, 신뢰도 차감의 근거로만 쓰인다.
 */
export type ViolationType =
  | 'profanity'
  | 'personal_attack'
  | 'disrespect'
  | 'off_topic'
  | 'threat';

/**
 * 위반 정도. LLM 스키마의 'none'은 여기 두지 않는다 —
 * "위반 없음"은 빈 배열 하나로만 표현해야 차감 합산에 특수 케이스가 생기지 않는다.
 */
export type ViolationSeverity = 'minor' | 'moderate' | 'high' | 'severe';

export interface DebateViolation {
  type: ViolationType;
  severity: ViolationSeverity;
  // 근거가 된 발언. 상대 발언 원문이므로 API로 내보내지 않는다.
  evidence: string;
}
