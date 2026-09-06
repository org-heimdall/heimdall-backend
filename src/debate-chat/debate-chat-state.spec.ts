import { GeneralException } from '../common/exceptions/general.exception';
import {
  DebateChatState,
  DebateTurnSchedule,
  TurnCommand,
  TurnSlot,
} from './debate-chat-state';
import { DebateChatStatus, DebatePhase, DebateSide } from './debate-chat.types';
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

  beforeEach(() => {
    idSeq = 0;
    state = new DebateChatState({
      debateId: DEBATE_ID,
      communityId: COMMUNITY_ID,
      speakers: {
        [DebateSide.SIDE_A]: SIDE_A_ID,
        [DebateSide.SIDE_B]: SIDE_B_ID,
      },
      // N=0: OPENING A,B → CLOSING A,B
      schedule: new DebateTurnSchedule(0),
      limits,
      now: () => NOW,
      generateId: () => `id-${++idSeq}`,
    });
  });

  describe('초기 상태·snapshot', () => {
    it('첫 차례는 OPENING/1/SIDE_A이고 제한값을 함께 내려준다', () => {
      expect(state.currentStatus).toBe(DebateChatStatus.IN_PROGRESS);
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
      expect(state.currentStatus).toBe(DebateChatStatus.DEBATE_FINALIZED);
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
});
