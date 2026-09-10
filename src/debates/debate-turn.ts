import { DebateMessage } from './entities/debate-message.entity';
import { DebateStatus } from './entities/debate-status.enum';
import { Debate } from './entities/debate.entity';

// 계약(frontend-api-contract.md)의 열거형·턴 모양. debate_message가 debates 도메인 것이므로
// "확정 턴 → 계약 turn"과 그 순서 규칙도 여기(소유 도메인)에 둔다. 채팅(debate-chat)과 REST가 같이 쓴다.

export enum DebatePhase {
  OPENING = 'OPENING',
  REBUTTAL_QUESTION = 'REBUTTAL_QUESTION',
  CLOSING = 'CLOSING',
}

export enum DebateSide {
  SIDE_A = 'SIDE_A',
  SIDE_B = 'SIDE_B',
}

export interface DraftMessage {
  id: string;
  debateId: string;
  clientMessageId?: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
  content: string;
  createdAt: string;
}

export interface DebateChatTurn extends DraftMessage {
  sequence: number;
}

export interface TurnSlot {
  phase: DebatePhase;
  round: number;
  side: DebateSide;
}

/**
 * 토론 1건의 발언 순서. OPENING(1라운드) → REBUTTAL_QUESTION(N라운드) → CLOSING(1라운드),
 * 모든 라운드는 SIDE_A → SIDE_B(D6). 순서 규칙이 바뀌면 build()만 고치면 된다.
 */
export class DebateTurnSchedule {
  private readonly slots: readonly TurnSlot[];

  constructor(rebuttalQuestionRounds: number) {
    if (
      !Number.isInteger(rebuttalQuestionRounds) ||
      rebuttalQuestionRounds < 0
    ) {
      throw new Error(
        `반론·질의 라운드 수가 올바르지 않습니다: ${rebuttalQuestionRounds}`,
      );
    }
    this.slots = DebateTurnSchedule.build(rebuttalQuestionRounds);
  }

  // 토론에 있는 차례의 총 개수. 전체 제한 시간(expiresAt) 계산의 근거다(R-6).
  get size(): number {
    return this.slots.length;
  }

  first(): TurnSlot {
    return this.slots[0];
  }

  // 확정 턴 수 index에 해당하는 차례. 전부 확정됐으면 null(현재 차례를 저장하지 않고 파생하는 근거).
  at(index: number): TurnSlot | null {
    return index >= 0 && index < this.slots.length ? this.slots[index] : null;
  }

  // 현재 차례의 다음 차례. 마지막이면 null.
  next(current: TurnSlot): TurnSlot | null {
    const index = this.indexOf(current);
    return index + 1 < this.slots.length ? this.slots[index + 1] : null;
  }

  isLast(current: TurnSlot): boolean {
    return this.indexOf(current) === this.slots.length - 1;
  }

  toArray(): TurnSlot[] {
    return [...this.slots];
  }

  // 스케줄에 없는 차례를 넘기는 것은 호출자 버그이므로 비즈니스 예외가 아닌 Error로 드러낸다.
  private indexOf(slot: TurnSlot): number {
    const index = this.slots.findIndex(
      (candidate) =>
        candidate.phase === slot.phase &&
        candidate.round === slot.round &&
        candidate.side === slot.side,
    );
    if (index < 0) {
      throw new Error(
        `스케줄에 없는 차례입니다: ${slot.phase}/${slot.round}/${slot.side}`,
      );
    }
    return index;
  }

  private static build(rebuttalQuestionRounds: number): TurnSlot[] {
    const slots: TurnSlot[] = [];
    const pushRound = (phase: DebatePhase, round: number) => {
      slots.push({ phase, round, side: DebateSide.SIDE_A });
      slots.push({ phase, round, side: DebateSide.SIDE_B });
    };

    pushRound(DebatePhase.OPENING, 1);
    for (let round = 1; round <= rebuttalQuestionRounds; round++) {
      pushRound(DebatePhase.REBUTTAL_QUESTION, round);
    }
    pushRound(DebatePhase.CLOSING, 1);
    return slots;
  }
}

export type DebateSpeakers = Record<DebateSide, string>;

// 기존 엔티티(host/opponent) → 계약(SIDE_A/SIDE_B) 매핑의 단일 출처(D3: 엔티티는 바꾸지 않는다).
// 상대가 아직 없는 토론은 편을 정할 수 없어 null이다. 편이 반드시 있어야 하는 채팅은 toSpeakers로 감싼다.
export function resolveSpeakers(debate: Debate): DebateSpeakers | null {
  if (debate.opponentId === null) {
    return null;
  }
  return {
    [DebateSide.SIDE_A]: debate.hostId,
    [DebateSide.SIDE_B]: debate.opponentId,
  };
}

export function oppositeSide(side: DebateSide): DebateSide {
  return side === DebateSide.SIDE_A ? DebateSide.SIDE_B : DebateSide.SIDE_A;
}

// 회원이 어느 편인지. 관전자(또는 상대가 없는 토론)는 null.
export function resolveSide(
  speakers: DebateSpeakers | null,
  memberId: string,
): DebateSide | null {
  if (speakers === null) return null;
  if (memberId === speakers[DebateSide.SIDE_A]) return DebateSide.SIDE_A;
  if (memberId === speakers[DebateSide.SIDE_B]) return DebateSide.SIDE_B;
  return null;
}

// 확정 턴 행 → 계약 turn. phase/round는 스케줄에서, 편은 발언자에서 파생한다
// (P2-8: 사실만 저장하고 나머지는 계산). 채팅 저장소와 REST 조회가 같은 변환을 쓴다.
export function toDebateTurn(
  row: DebateMessage,
  speakers: DebateSpeakers,
  schedule: DebateTurnSchedule,
): DebateChatTurn {
  const sequence = row.sequence as number;
  const slot = schedule.at(sequence - 1);
  if (slot === null) {
    throw new Error(
      `스케줄 범위를 벗어난 확정 턴입니다: debateId=${row.debateId}, sequence=${sequence}`,
    );
  }

  return {
    id: row.id,
    debateId: row.debateId,
    speakerId: row.memberId,
    speakerSide:
      row.memberId === speakers[DebateSide.SIDE_A]
        ? DebateSide.SIDE_A
        : DebateSide.SIDE_B,
    phase: slot.phase,
    round: slot.round,
    content: row.body ?? '',
    createdAt: row.createdAt.toISOString(),
    sequence,
  };
}

export interface CurrentTurnInput {
  debateStatus: DebateStatus;
  schedule: DebateTurnSchedule;
  // 확정된 턴의 개수. 다음 차례는 이 값을 인덱스로 스케줄에서 읽는다.
  finalizedTurnCount: number;
  // 마지막 확정 턴의 시각(없으면 null).
  lastTurnCreatedAt: Date | null;
  startedAt: Date | null;
}

export interface CurrentTurnPosition {
  slot: TurnSlot;
  // 이 차례가 시작된 시각. 시작 시각을 알 수 없는 레거시 행은 null.
  startedAt: Date | null;
}

/**
 * 현재 차례(phase/round/side)와 그 시작 시각을 저장된 사실에서 파생한다(P2-8).
 * 진행 중이 아니거나 모든 차례가 끝났으면 null이다.
 *
 * 채팅 상태(DebateChatState)와 REST의 Debate DTO가 **반드시 같은 답을 내야 하므로**
 * 규칙은 이 함수 하나에만 둔다.
 */
export function deriveCurrentTurn(
  input: CurrentTurnInput,
): CurrentTurnPosition | null {
  if (input.debateStatus !== DebateStatus.IN_PROGRESS) {
    return null;
  }
  const slot = input.schedule.at(input.finalizedTurnCount);
  if (slot === null) {
    return null;
  }
  // 차례가 시작된 시각 = 마지막 확정 턴의 시각, 없으면 토론 시작 시각.
  return { slot, startedAt: input.lastTurnCreatedAt ?? input.startedAt };
}
