import { randomUUID } from 'node:crypto';
import { GeneralException } from '../common/exceptions/general.exception';
import { Debate } from '../debates/entities/debate.entity';
import {
  CurrentTurn,
  DebateChatSnapshot,
  DebateChatTurn,
  DebateEndReason,
  DebatePhase,
  DebateSide,
  DebateStatus,
  DraftAppendStatus,
  DraftMessage,
} from './debate-chat.types';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

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

export interface DebateTurnLimits {
  maxContentLength: number;
  maxTotalCharacters: number;
  maxDurationSeconds: number;
}

export type DebateSpeakers = Record<DebateSide, string>;

// 기존 엔티티(host/opponent) → 계약(SIDE_A/SIDE_B) 매핑의 단일 출처(D3: 엔티티는 바꾸지 않는다).
export function toSpeakers(debate: Debate): DebateSpeakers {
  if (debate.opponentId === null) {
    throw new GeneralException(DebateChatErrorCode.OPPONENT_MISSING);
  }
  return {
    [DebateSide.SIDE_A]: debate.hostId,
    [DebateSide.SIDE_B]: debate.opponentId,
  };
}

// 명령이 가리키는 차례(발언자 + phase/round). send/finalize 공통.
export interface TurnCommand {
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
}

export interface DraftAppendResult {
  status: DraftAppendStatus;
  message: DraftMessage;
}

export interface TurnFinalizeResult {
  turn: DebateChatTurn;
  // 이번 확정으로 마지막 차례까지 끝났는지. true면 status가 DEBATE_FINALIZED로 바뀌어 있다.
  ended: boolean;
}

// debate 행에 반영할 변경. 세 값을 함께 쓰므로 부분 갱신 없이 통째로 넘긴다.
export interface DebateRowChanges {
  debateStatus: DebateStatus;
  startedAt: Date | null;
  endedAt: Date | null;
}

/**
 * 이번 작업이 상태에 남긴 변경. 저장소가 drainChanges()로 꺼내 Redis·DB에 반영한다.
 * 상태 객체는 저장 수단을 모르고, 저장소는 도메인 규칙을 모른다.
 */
export interface DebateChatStateChanges {
  // 추가된 draft와 그것이 속한 차례 인덱스(= 그 시점의 확정 턴 수).
  appendedDrafts: { turnIndex: number; message: DraftMessage }[];
  finalizedTurn: DebateChatTurn | null;
  // draft를 비워야 하는 차례 인덱스(확정으로 소모했거나 시간 초과로 버렸을 때).
  clearedDraftTurnIndex: number | null;
  debate: DebateRowChanges | null;
  // 이번 작업에서 토론이 끝났다면 그 사유. 방에 debate.ended를 보낼지 판단하는 근거다.
  endReason: DebateEndReason | null;
}

function emptyChanges(): DebateChatStateChanges {
  return {
    appendedDrafts: [],
    finalizedTurn: null,
    clearedDraftTurnIndex: null,
    debate: null,
    endReason: null,
  };
}

export interface DebateChatStateProps {
  debateId: string;
  communityId: string;
  speakers: DebateSpeakers;
  schedule: DebateTurnSchedule;
  limits: DebateTurnLimits;
  debateStatus: DebateStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  // 확정된 턴(sequence 오름차순)과 현재 차례의 draft.
  turns: DebateChatTurn[];
  drafts: DraftMessage[];
  // clientMessageId → 그때 저장한 draft. 중복 판정은 토론 단위(D12)라 확정된 차례의 것도 남는다.
  clientMessages?: Map<string, DraftMessage>;
  // 시각·식별자 생성은 주입 가능하게 두어 테스트에서 고정한다.
  now?: () => Date;
  generateId?: () => string;
}

/**
 * 토론 1건의 채팅 상태(애그리거트). 현재 차례, 확정된 턴, 진행 중 draft, 누적 글자 수의 불변식을
 * 이 클래스 안에서만 바꾼다. 저장소는 저장된 사실로 이 객체를 rehydrate하고, 작업이 끝나면
 * drainChanges()로 변경만 꺼내 반영한다.
 *
 * 현재 차례(phase/round/side)와 차례 시작 시각은 저장하지 않고 확정 턴 수에서 파생한다(P2-8).
 */
export class DebateChatState {
  readonly debateId: string;
  readonly communityId: string;
  private readonly speakers: DebateSpeakers;
  private readonly schedule: DebateTurnSchedule;
  private readonly limits: DebateTurnLimits;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  private status: DebateStatus;
  private startedAt: Date | null;
  private endedAt: Date | null;
  private readonly turns: DebateChatTurn[];
  private drafts: DraftMessage[];
  private readonly draftsByClientMessageId: Map<string, DraftMessage>;
  private changes: DebateChatStateChanges = emptyChanges();

  private constructor(props: DebateChatStateProps) {
    this.debateId = props.debateId;
    this.communityId = props.communityId;
    this.speakers = props.speakers;
    this.schedule = props.schedule;
    this.limits = props.limits;
    this.now = props.now ?? (() => new Date());
    this.generateId = props.generateId ?? randomUUID;
    this.status = props.debateStatus;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
    this.turns = [...props.turns];
    this.drafts = [...props.drafts];
    this.draftsByClientMessageId = new Map(props.clientMessages ?? []);
  }

  // 저장된 사실로 상태를 복원한다. 상태 객체를 만드는 유일한 경로다.
  static rehydrate(props: DebateChatStateProps): DebateChatState {
    return new DebateChatState(props);
  }

  get currentStatus(): DebateStatus {
    return this.status;
  }

  get turnCount(): number {
    return this.turns.length;
  }

  // 아직 시작 전(READY)인 토론을 진행 중으로 전이시킨다(P2-3: 첫 접속 시 시작).
  // 이미 시작했거나 끝난 토론에서는 아무 일도 하지 않는다.
  start(): void {
    if (this.status !== DebateStatus.READY) {
      return;
    }
    this.status = DebateStatus.IN_PROGRESS;
    this.startedAt = this.now();
    this.recordDebateChange();
  }

  // 회원이 어느 편인지. 관전자는 null.
  resolveSide(memberId: string): DebateSide | null {
    if (memberId === this.speakers[DebateSide.SIDE_A]) return DebateSide.SIDE_A;
    if (memberId === this.speakers[DebateSide.SIDE_B]) return DebateSide.SIDE_B;
    return null;
  }

  // draft 추가. 발언자·차례·길이를 검증하고, clientMessageId가 같으면 저장 없이 DUPLICATE로 응답한다.
  appendDraft(
    memberId: string,
    command: TurnCommand & { content: string },
    clientMessageId?: string,
  ): DraftAppendResult {
    this.assertCommandAllowed(memberId, command);

    const duplicate =
      clientMessageId !== undefined
        ? this.draftsByClientMessageId.get(clientMessageId)
        : undefined;
    if (duplicate) {
      return { status: 'DUPLICATE', message: duplicate };
    }

    if (command.content.length > this.limits.maxContentLength) {
      throw new GeneralException(DebateChatErrorCode.CONTENT_TOO_LONG);
    }
    if (
      this.totalCharacters() + command.content.length >
      this.limits.maxTotalCharacters
    ) {
      throw new GeneralException(
        DebateChatErrorCode.TURN_CHARACTER_LIMIT_EXCEEDED,
      );
    }

    const message: DraftMessage = {
      id: this.generateId(),
      debateId: this.debateId,
      clientMessageId,
      speakerId: memberId,
      speakerSide: command.speakerSide,
      phase: command.phase,
      round: command.round,
      content: command.content,
      createdAt: this.now().toISOString(),
    };
    this.drafts.push(message);
    if (clientMessageId !== undefined) {
      this.draftsByClientMessageId.set(clientMessageId, message);
    }
    this.changes.appendedDrafts.push({
      turnIndex: this.turns.length,
      message,
    });
    return { status: 'APPENDED', message };
  }

  // 현재 차례의 draft를 하나의 턴으로 확정하고 다음 차례로 넘긴다(D7: 개행으로 병합, 빈 턴 거부).
  finalizeTurn(memberId: string, command: TurnCommand): TurnFinalizeResult {
    const slot = this.assertCommandAllowed(memberId, command);
    if (this.drafts.length === 0) {
      throw new GeneralException(DebateChatErrorCode.TURN_EMPTY);
    }
    return this.confirmTurn(slot);
  }

  /**
   * 현재 차례가 제한 시간을 넘겼으면 그때까지 쓴 draft를 그대로 확정하고 **다음 차례로 넘긴다**(P2-4).
   * 확정 버튼을 누르지 못했을 뿐 실제로 한 발언이므로 버리지 않으며, 한 글자도 없으면 빈 턴이 된다.
   * 아직 시간이 남았거나 이미 끝난 토론이면 null을 돌려주므로, 락 안에서 몇 번을 불러도 안전하다.
   */
  expireTurn(): TurnFinalizeResult | null {
    const slot = this.currentSlot();
    const deadline = this.currentTurnDeadline();
    if (
      slot === null ||
      deadline === null ||
      this.now().getTime() < deadline.getTime()
    ) {
      return null;
    }
    return this.confirmTurn(slot);
  }

  // 현재 차례의 draft를 턴으로 굳혀 변경 기록에 남기고 다음 차례로 넘긴다.
  // 마지막 차례였으면 토론을 끝낸다(시간 초과로 확정됐더라도 모든 차례가 지난 것은 같다).
  private confirmTurn(slot: TurnSlot): TurnFinalizeResult {
    const turn: DebateChatTurn = {
      id: this.generateId(),
      debateId: this.debateId,
      speakerId: this.speakers[slot.side],
      speakerSide: slot.side,
      phase: slot.phase,
      round: slot.round,
      content: this.drafts.map((draft) => draft.content).join('\n'),
      createdAt: this.now().toISOString(),
      sequence: this.turns.length + 1,
    };
    this.changes.clearedDraftTurnIndex = this.turns.length;
    this.changes.finalizedTurn = turn;
    this.turns.push(turn);
    this.drafts = [];

    if (this.schedule.next(slot) !== null) {
      return { turn, ended: false };
    }
    this.end(
      DebateStatus.DEBATE_FINALIZED,
      DebateEndReason.ALL_TURNS_FINALIZED,
    );
    return { turn, ended: true };
  }

  // 현재 차례가 끝나야 하는 시각. 진행 중이 아니거나 시작 시각을 알 수 없으면 null.
  currentTurnDeadline(): Date | null {
    const startedAt = this.currentTurnStartedAt();
    if (startedAt === null) {
      return null;
    }
    return new Date(
      startedAt.getTime() + this.limits.maxDurationSeconds * 1000,
    );
  }

  snapshot(): DebateChatSnapshot {
    return {
      currentTurn: this.currentTurn(),
      turns: [...this.turns],
      draftMessages: [...this.drafts],
    };
  }

  // 저장소가 반영할 변경을 꺼내고 비운다. 두 번 꺼내면 두 번째는 비어 있다.
  drainChanges(): DebateChatStateChanges {
    const drained = this.changes;
    this.changes = emptyChanges();
    return drained;
  }

  private end(status: DebateStatus, reason: DebateEndReason): void {
    this.status = status;
    this.endedAt = this.now();
    this.changes.endReason = reason;
    this.recordDebateChange();
  }

  private recordDebateChange(): void {
    this.changes.debate = {
      debateStatus: this.status,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  // 현재 차례. 진행 중이 아니거나 모든 차례가 끝났으면 null.
  private currentSlot(): TurnSlot | null {
    if (this.status !== DebateStatus.IN_PROGRESS) {
      return null;
    }
    return this.schedule.at(this.turns.length);
  }

  // 현재 차례가 시작된 시각 = 마지막 확정 턴의 createdAt, 없으면 토론 시작 시각(P2-8).
  private currentTurnStartedAt(): Date | null {
    if (this.currentSlot() === null) {
      return null;
    }
    const lastTurn = this.turns[this.turns.length - 1];
    return lastTurn ? new Date(lastTurn.createdAt) : this.startedAt;
  }

  private currentTurn(): CurrentTurn | null {
    const slot = this.currentSlot();
    if (slot === null) {
      return null;
    }
    return {
      phase: slot.phase,
      round: slot.round,
      turnSide: slot.side,
      // 시작 시각을 알 수 없는 토론(레거시 행)은 지금부터 센다.
      startedAt: (this.currentTurnStartedAt() ?? this.now()).toISOString(),
      maxDurationSeconds: this.limits.maxDurationSeconds,
      maxTotalCharacters: this.limits.maxTotalCharacters,
    };
  }

  private totalCharacters(): number {
    return this.drafts.reduce((sum, draft) => sum + draft.content.length, 0);
  }

  /**
   * 명령을 낼 수 있는지 검증하고 현재 차례를 돌려준다. 순서가 곧 오류 우선순위다:
   * 종료된 토론 → 참가자 아님 → payload의 발언자가 본인이 아님 → 현재 차례가 아님.
   */
  private assertCommandAllowed(
    memberId: string,
    command: TurnCommand,
  ): TurnSlot {
    const slot = this.currentSlot();
    if (slot === null) {
      throw new GeneralException(DebateChatErrorCode.NOT_IN_PROGRESS);
    }

    const side = this.resolveSide(memberId);
    if (side === null) {
      throw new GeneralException(DebateChatErrorCode.NOT_PARTICIPANT);
    }
    if (command.speakerId !== memberId || command.speakerSide !== side) {
      throw new GeneralException(DebateChatErrorCode.SPEAKER_MISMATCH);
    }

    const matches =
      slot.side === side &&
      slot.phase === command.phase &&
      slot.round === command.round;
    if (!matches) {
      throw new GeneralException(DebateChatErrorCode.TURN_MISMATCH);
    }
    return slot;
  }
}
