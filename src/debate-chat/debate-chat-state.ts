import { randomUUID } from 'node:crypto';
import { GeneralException } from '../common/exceptions/general.exception';
import {
  CurrentTurn,
  DebateChatSnapshot,
  DebateChatStatus,
  DebateChatTurn,
  DebatePhase,
  DebateSide,
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

interface DebateChatStateProps {
  debateId: string;
  communityId: string;
  speakers: DebateSpeakers;
  schedule: DebateTurnSchedule;
  limits: DebateTurnLimits;
  // 시각·식별자 생성은 주입 가능하게 두어 테스트에서 고정한다.
  now?: () => Date;
  generateId?: () => string;
}

/**
 * 토론 1건의 채팅 상태(애그리거트). 현재 차례, 확정된 턴, 진행 중 draft, 누적 글자 수의 불변식을
 * 이 클래스 안에서만 바꾼다. 저장소(인메모리/DB)는 이 객체를 통째로 읽고 쓴다.
 */
export class DebateChatState {
  readonly debateId: string;
  readonly communityId: string;
  private readonly speakers: DebateSpeakers;
  private readonly schedule: DebateTurnSchedule;
  private readonly limits: DebateTurnLimits;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  private status: DebateChatStatus = DebateChatStatus.IN_PROGRESS;
  private current: (TurnSlot & { startedAt: string }) | null;
  private readonly turns: DebateChatTurn[] = [];
  private drafts: DraftMessage[] = [];
  // clientMessageId 중복 방지는 토론 단위. 같은 id 재전송은 처음 저장한 메시지를 그대로 돌려준다.
  private readonly draftsByClientMessageId = new Map<string, DraftMessage>();

  constructor(props: DebateChatStateProps) {
    this.debateId = props.debateId;
    this.communityId = props.communityId;
    this.speakers = props.speakers;
    this.schedule = props.schedule;
    this.limits = props.limits;
    this.now = props.now ?? (() => new Date());
    this.generateId = props.generateId ?? randomUUID;
    this.current = this.startSlot(this.schedule.first());
  }

  get currentStatus(): DebateChatStatus {
    return this.status;
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
    return { status: 'APPENDED', message };
  }

  // 현재 차례의 draft를 하나의 턴으로 확정하고 다음 차례로 넘긴다(D7: 개행으로 병합, 빈 턴 거부).
  finalizeTurn(memberId: string, command: TurnCommand): TurnFinalizeResult {
    this.assertCommandAllowed(memberId, command);
    if (this.drafts.length === 0) {
      throw new GeneralException(DebateChatErrorCode.TURN_EMPTY);
    }

    const turn: DebateChatTurn = {
      id: this.generateId(),
      debateId: this.debateId,
      speakerId: memberId,
      speakerSide: command.speakerSide,
      phase: command.phase,
      round: command.round,
      content: this.drafts.map((draft) => draft.content).join('\n'),
      createdAt: this.now().toISOString(),
      sequence: this.turns.length + 1,
    };
    this.turns.push(turn);
    this.drafts = [];

    const next = this.schedule.next(this.current!);
    if (next === null) {
      this.current = null;
      this.status = DebateChatStatus.DEBATE_FINALIZED;
      return { turn, ended: true };
    }
    this.current = this.startSlot(next);
    return { turn, ended: false };
  }

  snapshot(): DebateChatSnapshot {
    return {
      currentTurn: this.currentTurn(),
      turns: [...this.turns],
      draftMessages: [...this.drafts],
    };
  }

  private currentTurn(): CurrentTurn | null {
    if (this.current === null) {
      return null;
    }
    return {
      phase: this.current.phase,
      round: this.current.round,
      turnSide: this.current.side,
      startedAt: this.current.startedAt,
      maxDurationSeconds: this.limits.maxDurationSeconds,
      maxTotalCharacters: this.limits.maxTotalCharacters,
    };
  }

  private totalCharacters(): number {
    return this.drafts.reduce((sum, draft) => sum + draft.content.length, 0);
  }

  /**
   * 명령을 낼 수 있는지 검증. 순서가 곧 오류 우선순위다:
   * 종료된 토론 → 참가자 아님 → payload의 발언자가 본인이 아님 → 현재 차례가 아님.
   */
  private assertCommandAllowed(memberId: string, command: TurnCommand): void {
    if (this.status !== DebateChatStatus.IN_PROGRESS || this.current === null) {
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
      this.current.side === side &&
      this.current.phase === command.phase &&
      this.current.round === command.round;
    if (!matches) {
      throw new GeneralException(DebateChatErrorCode.TURN_MISMATCH);
    }
  }

  private startSlot(slot: TurnSlot): TurnSlot & { startedAt: string } {
    return { ...slot, startedAt: this.now().toISOString() };
  }
}
