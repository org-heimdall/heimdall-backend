import { DebateSide } from './judge.interface';

export type JudgmentStatus = 'PENDING' | 'FAILED' | 'JUDGED';

export interface ParticipantSolution {
  score: number;
  judgeReason: string[];
}

export type DebateSolution =
  | { status: 'PENDING'; requestedAt: string }
  | { status: 'FAILED'; failedAt: string }
  | {
      status: 'JUDGED';
      judgedAt: string;
      model: string;
      host: ParticipantSolution;
      opponent: ParticipantSolution;
    };

export type JudgedSolution = Extract<DebateSolution, { status: 'JUDGED' }>;

// 판정 요청 시점의 페이로드
export function createPendingSolution(): DebateSolution {
  return { status: 'PENDING', requestedAt: new Date().toISOString() };
}

// 판정 실패 페이로드. FAILED는 재요청 검증을 통과하므로 다시 요청할 수 있다.
export function createFailedSolution(): DebateSolution {
  return { status: 'FAILED', failedAt: new Date().toISOString() };
}

// 판정 결과 페이로드. 승자는 Debate.winnerId에만 기록하므로 여기 담지 않는다.
export function createJudgedSolution(
  model: string,
  participants: Record<DebateSide, ParticipantSolution>,
): DebateSolution {
  return {
    status: 'JUDGED',
    judgedAt: new Date().toISOString(),
    model,
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
    !host ||
    !opponent
  ) {
    return null;
  }

  return {
    status: 'JUDGED',
    judgedAt: value.judgedAt,
    model: value.model,
    host,
    opponent,
  };
}

function toParticipantSolution(value: unknown): ParticipantSolution | null {
  if (!isRecord(value)) {
    return null;
  }

  const { score, judgeReason } = value;
  if (typeof score !== 'number' || !Array.isArray(judgeReason)) {
    return null;
  }

  return { score, judgeReason: judgeReason.filter(isString) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
