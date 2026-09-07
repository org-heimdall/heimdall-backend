import { GeneralException } from '../common/exceptions/general.exception';
import {
  DebateChatState,
  DebateChatStateProps,
  DebateTurnSchedule,
  TurnCommand,
  TurnSlot,
} from './debate-chat-state';
import {
  DebateChatTurn,
  DebateEndReason,
  DebatePhase,
  DebateSide,
  DebateStatus,
  DraftMessage,
} from './debate-chat.types';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

describe('DebateTurnSchedule', () => {
  const slot = (
    phase: DebatePhase,
    round: number,
    side: DebateSide,
  ): TurnSlot => ({ phase, round, side });

  it('N=0이면 OPENING(A,B) → CLOSING(A,B) 4개 차례다', () => {
    expect(new DebateTurnSchedule(0).toArray()).toEqual([
      slot(DebatePhase.OPENING, 1, DebateSide.SIDE_A),
      slot(DebatePhase.OPENING, 1, DebateSide.SIDE_B),
      slot(DebatePhase.CLOSING, 1, DebateSide.SIDE_A),
      slot(DebatePhase.CLOSING, 1, DebateSide.SIDE_B),
    ]);
  });

  it('N=2이면 반론·질의 라운드마다 A→B 순서로 끼워 넣는다', () => {
    expect(new DebateTurnSchedule(2).toArray()).toEqual([
      slot(DebatePhase.OPENING, 1, DebateSide.SIDE_A),
      slot(DebatePhase.OPENING, 1, DebateSide.SIDE_B),
      slot(DebatePhase.REBUTTAL_QUESTION, 1, DebateSide.SIDE_A),
      slot(DebatePhase.REBUTTAL_QUESTION, 1, DebateSide.SIDE_B),
      slot(DebatePhase.REBUTTAL_QUESTION, 2, DebateSide.SIDE_A),
      slot(DebatePhase.REBUTTAL_QUESTION, 2, DebateSide.SIDE_B),
      slot(DebatePhase.CLOSING, 1, DebateSide.SIDE_A),
      slot(DebatePhase.CLOSING, 1, DebateSide.SIDE_B),
    ]);
  });

  it('first는 OPENING/1/SIDE_A이고 next는 순서대로 진행하며 마지막에서 null이다', () => {
    const schedule = new DebateTurnSchedule(1);
    const all = schedule.toArray();

    expect(schedule.first()).toEqual(all[0]);
    for (let i = 0; i < all.length - 1; i++) {
      expect(schedule.next(all[i])).toEqual(all[i + 1]);
      expect(schedule.isLast(all[i])).toBe(false);
    }
    expect(schedule.next(all[all.length - 1])).toBeNull();
    expect(schedule.isLast(all[all.length - 1])).toBe(true);
  });

  it('스케줄에 없는 차례를 넘기면 Error를 던진다(호출자 버그)', () => {
    const schedule = new DebateTurnSchedule(1);
    expect(() =>
      schedule.next(slot(DebatePhase.REBUTTAL_QUESTION, 5, DebateSide.SIDE_A)),
    ).toThrow(Error);
  });

  it('라운드 수가 음수/정수 아님이면 생성 시 Error를 던진다', () => {
    expect(() => new DebateTurnSchedule(-1)).toThrow(Error);
    expect(() => new DebateTurnSchedule(1.5)).toThrow(Error);
  });
});

describe('DebateChatState', () => {
  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';
  const SIDE_A_ID = 'side-a-uuid';
  const SIDE_B_ID = 'side-b-uuid';
  const NOW = new Date('2026-09-05T00:00:00.000Z');

  const limits = {
    maxContentLength: 10,
    maxTotalCharacters: 25,
    maxDurationSeconds: 180,
  };

  let idSeq: number;
  let clock: Date;
  let state: DebateChatState;

  const opening = (side: DebateSide): TurnCommand => ({
    speakerId: side === DebateSide.SIDE_A ? SIDE_A_ID : SIDE_B_ID,
    speakerSide: side,
    phase: DebatePhase.OPENING,
    round: 1,
  });

  const expectError = (fn: () => unknown, code: { code: string }) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(GeneralException);
      expect((error as GeneralException).appError.code).toBe(code.code);
      return;
    }
    throw new Error(`${code.code} 예외를 기대했지만 던지지 않았다`);
  };

  // 저장된 사실(상태·시작 시각·확정 턴·draft)에서 상태를 복원한다. 기본값은 갓 시작된 토론.
  const build = (overrides: Partial<DebateChatStateProps> = {}) =>
    DebateChatState.rehydrate({
      debateId: DEBATE_ID,
      communityId: COMMUNITY_ID,
      speakers: {
        [DebateSide.SIDE_A]: SIDE_A_ID,
        [DebateSide.SIDE_B]: SIDE_B_ID,
      },
      // N=0: OPENING A,B → CLOSING A,B
      schedule: new DebateTurnSchedule(0),
      limits,
      debateStatus: DebateStatus.IN_PROGRESS,
      startedAt: NOW,
      endedAt: null,
      turns: [],
      drafts: [],
      now: () => clock,
      generateId: () => `id-${++idSeq}`,
      ...overrides,
    });

  // sequence번째로 확정된 턴. phase/round/side는 스케줄(N=0)과 같은 순서로 만든다.
  const finalizedTurn = (
    sequence: number,
    createdAt: Date,
  ): DebateChatTurn => ({
    id: `turn-${sequence}`,
    debateId: DEBATE_ID,
    speakerId: sequence % 2 === 1 ? SIDE_A_ID : SIDE_B_ID,
    speakerSide: sequence % 2 === 1 ? DebateSide.SIDE_A : DebateSide.SIDE_B,
    phase: sequence <= 2 ? DebatePhase.OPENING : DebatePhase.CLOSING,
    round: 1,
    content: `발언 ${sequence}`,
    createdAt: createdAt.toISOString(),
    sequence,
  });

  beforeEach(() => {
    idSeq = 0;
    clock = NOW;
    state = build();
  });

  describe('초기 상태·snapshot', () => {
    it('첫 차례는 OPENING/1/SIDE_A이고 제한값을 함께 내려준다', () => {
      expect(state.currentStatus).toBe(DebateStatus.IN_PROGRESS);
      expect(state.snapshot()).toEqual({
        currentTurn: {
          phase: DebatePhase.OPENING,
          round: 1,
          turnSide: DebateSide.SIDE_A,
          startedAt: NOW.toISOString(),
          maxDurationSeconds: 180,
          maxTotalCharacters: 25,
        },
        turns: [],
        draftMessages: [],
      });
    });

    it('resolveSide는 참가자의 편을, 관전자는 null을 돌려준다', () => {
      expect(state.resolveSide(SIDE_A_ID)).toBe(DebateSide.SIDE_A);
      expect(state.resolveSide(SIDE_B_ID)).toBe(DebateSide.SIDE_B);
      expect(state.resolveSide('viewer')).toBeNull();
    });
  });

  describe('appendDraft', () => {
    it('현재 발언자의 draft를 저장하고 APPENDED로 응답한다', () => {
      const result = state.appendDraft(
        SIDE_A_ID,
        { ...opening(DebateSide.SIDE_A), content: '첫 발언' },
        'c-1',
      );

      expect(result).toEqual({
        status: 'APPENDED',
        message: {
          id: 'id-1',
          debateId: DEBATE_ID,
          clientMessageId: 'c-1',
          speakerId: SIDE_A_ID,
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          round: 1,
          content: '첫 발언',
          createdAt: NOW.toISOString(),
        },
      });
      expect(state.snapshot().draftMessages).toHaveLength(1);
    });

    it('같은 clientMessageId를 다시 보내면 저장하지 않고 DUPLICATE + 기존 메시지를 돌려준다', () => {
      const first = state.appendDraft(
        SIDE_A_ID,
        { ...opening(DebateSide.SIDE_A), content: '첫 발언' },
        'c-1',
      );
      const second = state.appendDraft(
        SIDE_A_ID,
        { ...opening(DebateSide.SIDE_A), content: '다른 내용' },
        'c-1',
      );

      expect(second).toEqual({ status: 'DUPLICATE', message: first.message });
      expect(state.snapshot().draftMessages).toHaveLength(1);
    });

    it('clientMessageId가 없으면 중복 검사 없이 매번 저장한다', () => {
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: 'a',
      });
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: 'a',
      });
      expect(state.snapshot().draftMessages).toHaveLength(2);
    });

    it('메시지 1건이 maxContentLength를 넘으면 CONTENT_TOO_LONG', () => {
      expectError(
        () =>
          state.appendDraft(SIDE_A_ID, {
            ...opening(DebateSide.SIDE_A),
            content: 'x'.repeat(11),
          }),
        DebateChatErrorCode.CONTENT_TOO_LONG,
      );
    });

    it('턴 누적 글자 수가 maxTotalCharacters를 넘으면 TURN_CHARACTER_LIMIT_EXCEEDED', () => {
      const send = (content: string) =>
        state.appendDraft(SIDE_A_ID, {
          ...opening(DebateSide.SIDE_A),
          content,
        });
      send('x'.repeat(10));
      send('x'.repeat(10));
      send('x'.repeat(5)); // 누적 25 = 한도, 통과
      expectError(
        () => send('x'),
        DebateChatErrorCode.TURN_CHARACTER_LIMIT_EXCEEDED,
      );
    });

    it('관전자는 NOT_PARTICIPANT', () => {
      expectError(
        () =>
          state.appendDraft('viewer', {
            ...opening(DebateSide.SIDE_A),
            speakerId: 'viewer',
            content: 'x',
          }),
        DebateChatErrorCode.NOT_PARTICIPANT,
      );
    });

    it('payload의 speakerId나 speakerSide가 본인과 다르면 SPEAKER_MISMATCH', () => {
      expectError(
        () =>
          state.appendDraft(SIDE_A_ID, {
            ...opening(DebateSide.SIDE_A),
            speakerId: SIDE_B_ID,
            content: 'x',
          }),
        DebateChatErrorCode.SPEAKER_MISMATCH,
      );
      expectError(
        () =>
          state.appendDraft(SIDE_A_ID, {
            ...opening(DebateSide.SIDE_A),
            speakerSide: DebateSide.SIDE_B,
            content: 'x',
          }),
        DebateChatErrorCode.SPEAKER_MISMATCH,
      );
    });

    it('현재 차례가 아닌 참가자(SIDE_B)의 발언은 TURN_MISMATCH', () => {
      expectError(
        () =>
          state.appendDraft(SIDE_B_ID, {
            ...opening(DebateSide.SIDE_B),
            content: 'x',
          }),
        DebateChatErrorCode.TURN_MISMATCH,
      );
    });

    it('phase/round가 현재 차례와 다르면 TURN_MISMATCH', () => {
      expectError(
        () =>
          state.appendDraft(SIDE_A_ID, {
            ...opening(DebateSide.SIDE_A),
            phase: DebatePhase.CLOSING,
            content: 'x',
          }),
        DebateChatErrorCode.TURN_MISMATCH,
      );
    });
  });

  describe('finalizeTurn', () => {
    it('draft를 개행으로 합쳐 sequence 1의 턴으로 확정하고 다음 차례(SIDE_B)로 넘긴다', () => {
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: '하나',
      });
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: '둘',
      });

      const result = state.finalizeTurn(SIDE_A_ID, opening(DebateSide.SIDE_A));

      expect(result.ended).toBe(false);
      expect(result.turn).toMatchObject({
        sequence: 1,
        speakerId: SIDE_A_ID,
        speakerSide: DebateSide.SIDE_A,
        content: '하나\n둘',
      });
      const snapshot = state.snapshot();
      expect(snapshot.turns).toEqual([result.turn]);
      expect(snapshot.draftMessages).toEqual([]);
      expect(snapshot.currentTurn).toMatchObject({
        phase: DebatePhase.OPENING,
        round: 1,
        turnSide: DebateSide.SIDE_B,
      });
    });

    it('draft가 없으면 TURN_EMPTY', () => {
      expectError(
        () => state.finalizeTurn(SIDE_A_ID, opening(DebateSide.SIDE_A)),
        DebateChatErrorCode.TURN_EMPTY,
      );
    });

    it('확정 후에는 누적 글자 수가 초기화되어 다음 차례가 한도를 새로 쓴다', () => {
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: 'x'.repeat(10),
      });
      state.finalizeTurn(SIDE_A_ID, opening(DebateSide.SIDE_A));

      expect(() =>
        state.appendDraft(SIDE_B_ID, {
          ...opening(DebateSide.SIDE_B),
          content: 'x'.repeat(10),
        }),
      ).not.toThrow();
    });

    it('마지막 차례를 확정하면 ended=true, DEBATE_FINALIZED, currentTurn null이 되고 이후 명령은 NOT_IN_PROGRESS', () => {
      const run = (side: DebateSide, phase: DebatePhase) => {
        const command = { ...opening(side), phase };
        state.appendDraft(command.speakerId, { ...command, content: 'x' });
        return state.finalizeTurn(command.speakerId, command);
      };

      expect(run(DebateSide.SIDE_A, DebatePhase.OPENING).ended).toBe(false);
      expect(run(DebateSide.SIDE_B, DebatePhase.OPENING).ended).toBe(false);
      expect(run(DebateSide.SIDE_A, DebatePhase.CLOSING).ended).toBe(false);
      const last = run(DebateSide.SIDE_B, DebatePhase.CLOSING);

      expect(last.ended).toBe(true);
      expect(last.turn.sequence).toBe(4);
      expect(state.currentStatus).toBe(DebateStatus.DEBATE_FINALIZED);
      expect(state.snapshot().currentTurn).toBeNull();
      expectError(
        () =>
          state.appendDraft(SIDE_A_ID, {
            ...opening(DebateSide.SIDE_A),
            content: 'x',
          }),
        DebateChatErrorCode.NOT_IN_PROGRESS,
      );
    });
  });

  describe('rehydrate', () => {
    it('확정 턴이 k개면 현재 차례는 schedule[k]이고 시작 시각은 마지막 턴의 createdAt이다', () => {
      const lastTurnAt = new Date(NOW.getTime() + 60_000);
      const restored = build({
        turns: [finalizedTurn(1, NOW), finalizedTurn(2, lastTurnAt)],
      });

      expect(restored.turnCount).toBe(2);
      expect(restored.snapshot().currentTurn).toEqual({
        phase: DebatePhase.CLOSING,
        round: 1,
        turnSide: DebateSide.SIDE_A,
        startedAt: lastTurnAt.toISOString(),
        maxDurationSeconds: 180,
        maxTotalCharacters: 25,
      });
    });

    it('확정 턴이 없으면 차례 시작 시각은 토론 시작 시각이다', () => {
      expect(state.snapshot().currentTurn?.startedAt).toBe(NOW.toISOString());
      expect(state.currentTurnDeadline()).toEqual(
        new Date(NOW.getTime() + 180_000),
      );
    });

    it('저장돼 있던 draft와 확정 턴을 그대로 돌려주고 이어서 확정할 수 있다', () => {
      const draft: DraftMessage = {
        id: 'draft-1',
        debateId: DEBATE_ID,
        clientMessageId: 'c-1',
        speakerId: SIDE_A_ID,
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.OPENING,
        round: 1,
        content: '이어서',
        createdAt: NOW.toISOString(),
      };
      const restored = build({ drafts: [draft] });

      expect(restored.snapshot().draftMessages).toEqual([draft]);
      expect(
        restored.finalizeTurn(SIDE_A_ID, opening(DebateSide.SIDE_A)).turn,
      ).toMatchObject({ sequence: 1, content: '이어서' });
    });

    it('clientMessageId 중복 판정은 확정된 차례의 것까지 이어진다(토론 단위)', () => {
      const previous: DraftMessage = {
        id: 'draft-1',
        debateId: DEBATE_ID,
        clientMessageId: 'c-1',
        speakerId: SIDE_A_ID,
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.OPENING,
        round: 1,
        content: '지난 차례',
        createdAt: NOW.toISOString(),
      };
      const restored = build({
        turns: [finalizedTurn(1, NOW)],
        clientMessages: new Map([['c-1', previous]]),
      });

      const result = restored.appendDraft(
        SIDE_B_ID,
        { ...opening(DebateSide.SIDE_B), content: '다시 보냄' },
        'c-1',
      );

      expect(result).toEqual({ status: 'DUPLICATE', message: previous });
    });

    it('이미 끝난 토론은 currentTurn이 null이고 명령을 받지 않는다', () => {
      const ended = build({
        debateStatus: DebateStatus.DEBATE_FINALIZED,
        endedAt: NOW,
        turns: [1, 2, 3, 4].map((sequence) => finalizedTurn(sequence, NOW)),
      });

      expect(ended.snapshot().currentTurn).toBeNull();
      expect(ended.currentTurnDeadline()).toBeNull();
      expectError(
        () =>
          ended.appendDraft(SIDE_A_ID, {
            ...opening(DebateSide.SIDE_A),
            content: 'x',
          }),
        DebateChatErrorCode.NOT_IN_PROGRESS,
      );
    });
  });

  describe('start', () => {
    it('아직 시작 전(READY)이면 진행 중으로 바꾸고 시작 시각을 변경 기록에 남긴다', () => {
      const ready = build({
        debateStatus: DebateStatus.READY,
        startedAt: null,
      });
      clock = new Date(NOW.getTime() + 5_000);

      ready.start();

      expect(ready.currentStatus).toBe(DebateStatus.IN_PROGRESS);
      expect(ready.snapshot().currentTurn?.startedAt).toBe(clock.toISOString());
      expect(ready.drainChanges().debate).toEqual({
        debateStatus: DebateStatus.IN_PROGRESS,
        startedAt: clock,
        endedAt: null,
      });
    });

    it('이미 시작했거나 끝난 토론에서는 아무 일도 하지 않는다', () => {
      state.start();
      expect(state.drainChanges().debate).toBeNull();

      const ended = build({ debateStatus: DebateStatus.FAILED, endedAt: NOW });
      ended.start();
      expect(ended.currentStatus).toBe(DebateStatus.FAILED);
      expect(ended.drainChanges().debate).toBeNull();
    });
  });

  describe('expireTurn', () => {
    it('제한 시간이 지나지 않았으면 아무 일도 하지 않는다', () => {
      clock = new Date(NOW.getTime() + 179_000);

      expect(state.expireTurn()).toBeNull();
      expect(state.currentStatus).toBe(DebateStatus.IN_PROGRESS);
      expect(state.drainChanges()).toMatchObject({
        finalizedTurn: null,
        debate: null,
        endReason: null,
      });
    });

    it('제한 시간이 지나면 쓴 draft를 그대로 확정하고 상대에게 차례를 넘긴다', () => {
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: '쓰다 만',
      });
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: '발언',
      });
      state.drainChanges();
      clock = new Date(NOW.getTime() + 180_000);

      const result = state.expireTurn();

      expect(result).toMatchObject({
        ended: false,
        turn: {
          sequence: 1,
          speakerId: SIDE_A_ID,
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          content: '쓰다 만\n발언',
        },
      });
      // 토론은 계속되고 차례만 SIDE_B로 넘어간다.
      expect(state.currentStatus).toBe(DebateStatus.IN_PROGRESS);
      expect(state.snapshot()).toMatchObject({
        currentTurn: {
          phase: DebatePhase.OPENING,
          turnSide: DebateSide.SIDE_B,
          startedAt: clock.toISOString(),
        },
        draftMessages: [],
      });
      expect(state.drainChanges()).toMatchObject({
        finalizedTurn: result!.turn,
        clearedDraftTurnIndex: 0,
        debate: null,
        endReason: null,
      });
    });

    it('한 글자도 쓰지 않은 차례는 빈 턴으로 남기고 넘어간다(차례 계산이 밀리지 않게)', () => {
      clock = new Date(NOW.getTime() + 180_000);

      const result = state.expireTurn();

      expect(result).toMatchObject({
        ended: false,
        turn: { sequence: 1, speakerId: SIDE_A_ID, content: '' },
      });
      expect(state.turnCount).toBe(1);
      expect(state.snapshot().currentTurn?.turnSide).toBe(DebateSide.SIDE_B);
    });

    it('반론·질의 라운드가 있는 토론(N=2)에서도 시간 초과가 phase·round를 스케줄대로 넘긴다', () => {
      // 양쪽이 아무 발언도 하지 않아 8개 차례가 차례로 시간 초과되는 상황.
      const restored = build({ schedule: new DebateTurnSchedule(2) });
      const visited: string[] = [];
      const endedFlags: boolean[] = [];

      for (let i = 0; i < 8; i++) {
        const current = restored.snapshot().currentTurn!;
        visited.push(`${current.phase}/${current.round}/${current.turnSide}`);
        clock = new Date(clock.getTime() + 180_000);
        endedFlags.push(restored.expireTurn()!.ended);
      }

      expect(visited).toEqual([
        'OPENING/1/SIDE_A',
        'OPENING/1/SIDE_B',
        // SIDE_B가 시간 초과되면 다음 phase로 넘어간다.
        'REBUTTAL_QUESTION/1/SIDE_A',
        'REBUTTAL_QUESTION/1/SIDE_B',
        // 반론·질의 라운드의 SIDE_B가 끝나면 round가 하나 올라간다.
        'REBUTTAL_QUESTION/2/SIDE_A',
        'REBUTTAL_QUESTION/2/SIDE_B',
        // 마지막 반론 라운드가 끝나면 CLOSING으로 넘어간다.
        'CLOSING/1/SIDE_A',
        'CLOSING/1/SIDE_B',
      ]);
      // 토론이 끝나는 것은 마지막 차례뿐이다.
      expect(endedFlags).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
      ]);
      expect(restored.turnCount).toBe(8);
      expect(restored.snapshot().currentTurn).toBeNull();
      expect(restored.currentStatus).toBe(DebateStatus.DEBATE_FINALIZED);
    });

    it('마지막 차례가 시간 초과되면 그 턴을 확정하며 토론이 정상 종료된다', () => {
      const restored = build({
        turns: [1, 2, 3].map((sequence) => finalizedTurn(sequence, NOW)),
      });
      clock = new Date(NOW.getTime() + 180_000);

      const result = restored.expireTurn();

      expect(result?.ended).toBe(true);
      expect(result?.turn.sequence).toBe(4);
      expect(restored.currentStatus).toBe(DebateStatus.DEBATE_FINALIZED);
      expect(restored.snapshot().currentTurn).toBeNull();
      expect(restored.drainChanges()).toMatchObject({
        debate: {
          debateStatus: DebateStatus.DEBATE_FINALIZED,
          endedAt: clock,
        },
        endReason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
    });

    it('마지막 확정 턴 이후로 다시 시간을 재므로 확정 직후에는 만료되지 않는다', () => {
      const lastTurnAt = new Date(NOW.getTime() + 170_000);
      const restored = build({ turns: [finalizedTurn(1, lastTurnAt)] });
      clock = new Date(lastTurnAt.getTime() + 179_000);

      expect(restored.expireTurn()).toBeNull();
    });

    it('이미 끝난 토론에서는 아무 일도 하지 않는다', () => {
      const ended = build({
        debateStatus: DebateStatus.DEBATE_FINALIZED,
        endedAt: NOW,
        turns: [1, 2, 3, 4].map((sequence) => finalizedTurn(sequence, NOW)),
      });
      clock = new Date(NOW.getTime() + 10 * 180_000);

      expect(ended.expireTurn()).toBeNull();
      expect(ended.currentStatus).toBe(DebateStatus.DEBATE_FINALIZED);
      expect(ended.drainChanges().finalizedTurn).toBeNull();
    });
  });

  describe('drainChanges', () => {
    it('draft 추가는 그 차례 인덱스와 함께 쌓이고, 한 번 꺼내면 비워진다', () => {
      const { message } = state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: 'x',
      });

      expect(state.drainChanges()).toEqual({
        appendedDrafts: [{ turnIndex: 0, message }],
        finalizedTurn: null,
        clearedDraftTurnIndex: null,
        debate: null,
        endReason: null,
      });
      expect(state.drainChanges()).toEqual({
        appendedDrafts: [],
        finalizedTurn: null,
        clearedDraftTurnIndex: null,
        debate: null,
        endReason: null,
      });
    });

    it('턴 확정은 확정 턴과 비울 draft 차례를 남기고, 토론 상태는 아직 바뀌지 않는다', () => {
      state.appendDraft(SIDE_A_ID, {
        ...opening(DebateSide.SIDE_A),
        content: 'x',
      });
      const { turn } = state.finalizeTurn(
        SIDE_A_ID,
        opening(DebateSide.SIDE_A),
      );

      expect(state.drainChanges()).toMatchObject({
        finalizedTurn: turn,
        clearedDraftTurnIndex: 0,
        debate: null,
        endReason: null,
      });
    });

    it('마지막 차례 확정은 DEBATE_FINALIZED와 종료 시각·사유까지 남긴다', () => {
      const restored = build({
        turns: [1, 2, 3].map((sequence) => finalizedTurn(sequence, NOW)),
      });
      restored.appendDraft(SIDE_B_ID, {
        ...opening(DebateSide.SIDE_B),
        phase: DebatePhase.CLOSING,
        content: '마지막',
      });
      restored.drainChanges();
      clock = new Date(NOW.getTime() + 1_000);

      const result = restored.finalizeTurn(SIDE_B_ID, {
        ...opening(DebateSide.SIDE_B),
        phase: DebatePhase.CLOSING,
      });

      expect(result.ended).toBe(true);
      expect(restored.drainChanges()).toMatchObject({
        finalizedTurn: result.turn,
        clearedDraftTurnIndex: 3,
        debate: {
          debateStatus: DebateStatus.DEBATE_FINALIZED,
          startedAt: NOW,
          endedAt: clock,
        },
        endReason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
    });
  });
});
