import type {
  DebateSide,
  DebateViolation,
  ViolationSeverity,
  ViolationType,
} from './judge.interface';

export type JudgmentStatus = 'PENDING' | 'FAILED' | 'JUDGED';

export type JudgmentWinner = DebateSide | 'draw';

export interface ParticipantSolution {
  score: number;
  judgeReason: string[];
  violations: DebateViolation[];
  socialCreditPenalty: number;
}

export type DebateSolution =
  | { status: 'PENDING'; requestedAt: string }
  | { status: 'FAILED'; failedAt: string }
  | {
      status: 'JUDGED';
      judgedAt: string;
      model: string;
      winner: JudgmentWinner;
      host: ParticipantSolution;
      opponent: ParticipantSolution;
    };

export type JudgedSolution = Extract<DebateSolution, { status: 'JUDGED' }>;

const VIOLATION_TYPES: ViolationType[] = [
  'profanity',
  'personal_attack',
  'disrespect',
  'off_topic',
  'threat',
];

const VIOLATION_SEVERITIES: ViolationSeverity[] = [
  'minor',
  'moderate',
  'high',
  'severe',
];

// 판정 요청 시점의 페이로드
export function createPendingSolution(): DebateSolution {
  return { status: 'PENDING', requestedAt: new Date().toISOString() };
}

// 판정 실패 페이로드. FAILED는 재요청 검증을 통과하므로 다시 요청할 수 있다.
export function createFailedSolution(): DebateSolution {
  return { status: 'FAILED', failedAt: new Date().toISOString() };
}

export function createJudgedSolution(
  model: string,
  winner: JudgmentWinner,
  participants: Record<DebateSide, ParticipantSolution>,
): DebateSolution {
  return {
    status: 'JUDGED',
    judgedAt: new Date().toISOString(),
    model,
    winner,
    host: participants.host,
    opponent: participants.opponent,
  };
}

/**
 * jsonb 컬럼은 DB에서 사실상 any로 올라오므로 런타임에 형태를 확인한다.
 * 판정이 요청된 적이 없거나(null) 알아볼 수 없는 값이면 null을 반환한다.
 */
export function toDebateSolution(value: unknown): DebateSolution | null {
  if (!isRecord(value)) {
    return null;
  }

  switch (value.status) {
    case 'PENDING':
      return isString(value.requestedAt)
        ? { status: 'PENDING', requestedAt: value.requestedAt }
        : null;
    case 'FAILED':
      return isString(value.failedAt)
        ? { status: 'FAILED', failedAt: value.failedAt }
        : null;
    case 'JUDGED':
      return toJudgedSolution(value);
    default:
      return null;
  }
}

export function isJudged(
  solution: DebateSolution | null,
): solution is JudgedSolution {
  return solution?.status === 'JUDGED';
}

function toJudgedSolution(
  value: Record<string, unknown>,
): JudgedSolution | null {
  const host = toParticipantSolution(value.host);
  const opponent = toParticipantSolution(value.opponent);

  if (
    !isString(value.judgedAt) ||
    !isString(value.model) ||
    !isWinner(value.winner) ||
    !host ||
    !opponent
  ) {
    return null;
  }

  return {
    status: 'JUDGED',
    judgedAt: value.judgedAt,
    model: value.model,
    winner: value.winner,
    host,
    opponent,
  };
}

function toParticipantSolution(value: unknown): ParticipantSolution | null {
  if (!isRecord(value)) {
    return null;
  }

  const { score, judgeReason, violations, socialCreditPenalty } = value;
  if (typeof score !== 'number' || !Array.isArray(judgeReason)) {
    return null;
  }

  return {
    score,
    judgeReason: judgeReason.filter(isString),
    // 위반 내역과 차감액은 감사용 부가 정보라, 없으면 "위반 없음"으로 읽는다.
    violations: Array.isArray(violations)
      ? violations.flatMap(toViolation)
      : [],
    socialCreditPenalty:
      typeof socialCreditPenalty === 'number' ? socialCreditPenalty : 0,
  };
}

// 알아볼 수 없는 항목은 빈 배열로 흘려보내 감사 기록 한 줄 때문에 판정 전체가 깨지지 않게 한다.
function toViolation(value: unknown): DebateViolation[] {
  if (!isRecord(value)) {
    return [];
  }

  const { type, severity, evidence } = value;
  if (
    !VIOLATION_TYPES.includes(type as ViolationType) ||
    !VIOLATION_SEVERITIES.includes(severity as ViolationSeverity) ||
    !isString(evidence)
  ) {
    return [];
  }

  return [
    {
      type: type as ViolationType,
      severity: severity as ViolationSeverity,
      evidence,
    },
  ];
}

function isWinner(value: unknown): value is JudgmentWinner {
  return value === 'host' || value === 'opponent' || value === 'draw';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
