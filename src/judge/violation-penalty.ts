import type { DebateViolation, ViolationSeverity } from './judge.interface';

/**
 * 위반 정도별 신뢰도 차감량. 이 표가 차감 정책의 단일 출처다.
 * 판정기(LLM 어댑터)가 아니라 여기에 두는 이유는, provider를 바꾸거나 판정을 별도 서비스로
 * 떼어내도 정책은 그대로 남아야 하기 때문이다.
 */
const SOCIAL_CREDIT_PENALTY: Record<ViolationSeverity, number> = {
  minor: 1,
  moderate: 3,
  high: 7,
  severe: 15,
};

// 위반 목록을 신뢰도 차감량으로 환산한다(건별 합산). 위반이 없으면 0.
export function toSocialCreditPenalty(violations: DebateViolation[]): number {
  return violations.reduce(
    (sum, violation) => sum + SOCIAL_CREDIT_PENALTY[violation.severity],
    0,
  );
}
