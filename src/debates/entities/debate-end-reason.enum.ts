// 토론이 끝난 이유(debate.end_reason). 계약의 debate.ended reason과 같은 값 집합이며,
// JUDGMENT_FAILED만 내부 전용이라 wire로 나가지 않는다.
// 한 차례의 시간 초과는 토론이 아니라 차례만 넘기므로 여기에 들어가지 않는다.
export enum DebateEndReason {
  ALL_TURNS_FINALIZED = 'ALL_TURNS_FINALIZED',
  // 발언자가 POST /debates/:id/forfeit으로 기권했다. 상태는 FAILED, 승자는 상대다.
  FORFEIT = 'FORFEIT',
  // 모든 차례가 지났는데 한쪽(또는 양쪽)의 확정 턴이 전부 비어 있다. 상태는 FAILED, 승자는 발언한 쪽이다.
  TOTAL_TIME_EXPIRED = 'TOTAL_TIME_EXPIRED',
  // 판정 파이프라인(분석·판정)이 최종 실패했다. /judge/retry로 되돌릴 수 있는 유일한 FAILED다.
  JUDGMENT_FAILED = 'JUDGMENT_FAILED',
}
