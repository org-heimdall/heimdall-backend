import { DebateEndReason } from '../debates/entities/debate-end-reason.enum';
import { DebateStatus } from '../debates/entities/debate-status.enum';

// 토론 결과를 바깥(커뮤니티 상태·시스템 메시지·점수·방 이벤트)에 반영해야 하는 순간의 종류.
export enum DebateOutcomeKind {
  // 초대 수락으로 토론이 만들어졌다.
  STARTED = 'STARTED',
  // 판정이 완료됐다(COMPLETED).
  RESULT = 'RESULT',
  // 발언자가 기권했다(FAILED + FORFEIT).
  FORFEIT = 'FORFEIT',
  // 모든 차례가 지났는데 한쪽(또는 양쪽)이 한 번도 발언하지 않았다(FAILED + TOTAL_TIME_EXPIRED).
  TOTAL_TIMEOUT = 'TOTAL_TIMEOUT',
  // 판정 파이프라인이 최종 실패했다(FAILED + JUDGMENT_FAILED).
  JUDGMENT_FAILED = 'JUDGMENT_FAILED',
}

/**
 * 호출자가 토론 상태 전이를 성공시킨 직후의 사실. 승자는 호출자가 이미 정한 값을 그대로 받는다 —
 * 판정은 JudgmentWinner, 기권·시간 초과는 채팅 상태가 승자 결정의 단일 출처다.
 */
export interface DebateOutcome {
  debateId: string;
  communityId: string;
  kind: DebateOutcomeKind;
  // 전이 후 토론 상태. debate.ended payload에 그대로 실린다.
  status: DebateStatus;
  // 끝난 이유. 아직 끝나지 않은 STARTED는 null.
  reason: DebateEndReason | null;
  // 보상 대상. 무승부·양쪽 무발언·승패가 없는 종류는 null.
  winnerId: string | null;
}
