// 계약(frontend-api-contract.md)의 DebateStatus. 토론 진행 단계를 나타내며 soft-delete용
// status(ResourceStatus)와는 별개 컬럼이다(debate.debate_status).
export enum DebateStatus {
  READY = 'READY',
  IN_PROGRESS = 'IN_PROGRESS',
  DEBATE_FINALIZED = 'DEBATE_FINALIZED',
  JUDGING = 'JUDGING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
