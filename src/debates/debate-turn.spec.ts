import { ResourceStatus } from '../common/entities/resource-status.enum';
import {
  DebatePhase,
  DebateSide,
  DebateTurnSchedule,
  deriveCurrentTurn,
  oppositeSide,
  resolveSide,
  resolveSpeakers,
  toDebateTurn,
} from './debate-turn';
import { DebateMessage } from './entities/debate-message.entity';
import { DebateStatus } from './entities/debate-status.enum';
import { Debate } from './entities/debate.entity';

describe('debate-turn', () => {
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const STARTED_AT = new Date('2026-09-07T12:00:00.000Z');
  const LAST_TURN_AT = new Date('2026-09-07T12:03:00.000Z');

  // N=1 → OPENING(A,B) → REBUTTAL_QUESTION 1라운드(A,B) → CLOSING(A,B) 6턴
  const schedule = new DebateTurnSchedule(1);
  const speakers = {
    [DebateSide.SIDE_A]: HOST_ID,
    [DebateSide.SIDE_B]: OPPONENT_ID,
  };

  describe('DebateTurnSchedule', () => {
    it('OPENING → REBUTTAL_QUESTION N라운드 → CLOSING을 SIDE_A, SIDE_B 순서로 만든다', () => {
      expect(schedule.toArray()).toEqual([
        { phase: DebatePhase.OPENING, round: 1, side: DebateSide.SIDE_A },
        { phase: DebatePhase.OPENING, round: 1, side: DebateSide.SIDE_B },
        {
          phase: DebatePhase.REBUTTAL_QUESTION,
          round: 1,
          side: DebateSide.SIDE_A,
        },
        {
          phase: DebatePhase.REBUTTAL_QUESTION,
          round: 1,
          side: DebateSide.SIDE_B,
        },
        { phase: DebatePhase.CLOSING, round: 1, side: DebateSide.SIDE_A },
        { phase: DebatePhase.CLOSING, round: 1, side: DebateSide.SIDE_B },
      ]);
      expect(schedule.size).toBe(6);
    });

    it('라운드 수가 음수이거나 정수가 아니면 만들 수 없다', () => {
      expect(() => new DebateTurnSchedule(-1)).toThrow();
      expect(() => new DebateTurnSchedule(1.5)).toThrow();
    });
  });

  describe('deriveCurrentTurn', () => {
    const derive = (
      finalizedTurnCount: number,
      status = DebateStatus.IN_PROGRESS,
    ) =>
      deriveCurrentTurn({
        debateStatus: status,
        schedule,
        finalizedTurnCount,
        lastTurnCreatedAt: finalizedTurnCount > 0 ? LAST_TURN_AT : null,
        startedAt: STARTED_AT,
      });

    it('확정 턴이 없으면 첫 차례이고 시작 시각은 토론 시작 시각이다', () => {
      expect(derive(0)).toEqual({
        slot: schedule.at(0),
        startedAt: STARTED_AT,
      });
    });

    it('확정 턴이 k개면 k번째 차례이고 시작 시각은 마지막 확정 턴의 시각이다', () => {
      expect(derive(3)).toEqual({
        slot: schedule.at(3),
        startedAt: LAST_TURN_AT,
      });
    });

    it('모든 차례가 끝났으면 null이다', () => {
      expect(derive(schedule.size)).toBeNull();
    });

    it('진행 중이 아닌 토론은 확정 턴 수와 무관하게 null이다', () => {
      expect(derive(0, DebateStatus.READY)).toBeNull();
      expect(derive(2, DebateStatus.DEBATE_FINALIZED)).toBeNull();
      expect(derive(2, DebateStatus.FAILED)).toBeNull();
    });
  });

  describe('편 매핑', () => {
    const buildDebate = (opponentId: string | null): Debate =>
      Object.assign(new Debate(), { hostId: HOST_ID, opponentId });

    it('host는 SIDE_A, opponent는 SIDE_B다', () => {
      expect(resolveSpeakers(buildDebate(OPPONENT_ID))).toEqual(speakers);
    });

    it('상대가 없는 토론은 편을 정할 수 없다', () => {
      expect(resolveSpeakers(buildDebate(null))).toBeNull();
    });

    it('발언자가 아닌 회원(관전자)의 편은 null이다', () => {
      expect(resolveSide(speakers, HOST_ID)).toBe(DebateSide.SIDE_A);
      expect(resolveSide(speakers, OPPONENT_ID)).toBe(DebateSide.SIDE_B);
      expect(resolveSide(speakers, 'watcher-uuid')).toBeNull();
      expect(resolveSide(null, HOST_ID)).toBeNull();
    });

    it('상대 편을 돌려준다', () => {
      expect(oppositeSide(DebateSide.SIDE_A)).toBe(DebateSide.SIDE_B);
      expect(oppositeSide(DebateSide.SIDE_B)).toBe(DebateSide.SIDE_A);
    });
  });

  describe('toDebateTurn', () => {
    const buildRow = (sequence: number, memberId: string): DebateMessage =>
      Object.assign(new DebateMessage(), {
        id: `message-${sequence}`,
        memberId,
        debateId: 'debate-uuid',
        body: '내용',
        sequence,
        createdAt: LAST_TURN_AT,
        status: ResourceStatus.NORMAL,
      });

    it('phase·round는 스케줄에서, 편은 발언자에서 파생한다', () => {
      expect(toDebateTurn(buildRow(3, HOST_ID), speakers, schedule)).toEqual({
        id: 'message-3',
        debateId: 'debate-uuid',
        speakerId: HOST_ID,
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.REBUTTAL_QUESTION,
        round: 1,
        content: '내용',
        createdAt: LAST_TURN_AT.toISOString(),
        sequence: 3,
      });
    });

    it('내용이 없는 턴(시간 초과로 빈 채 확정)은 빈 문자열이 된다', () => {
      const row = Object.assign(buildRow(1, OPPONENT_ID), { body: null });

      expect(toDebateTurn(row, speakers, schedule)).toMatchObject({
        speakerSide: DebateSide.SIDE_B,
        content: '',
      });
    });

    it('스케줄 범위를 벗어난 sequence는 데이터 오류로 드러낸다', () => {
      expect(() =>
        toDebateTurn(buildRow(schedule.size + 1, HOST_ID), speakers, schedule),
      ).toThrow();
    });
  });
});
