import { Test, TestingModule } from '@nestjs/testing';
import { GeneralException } from '../common/exceptions/general.exception';
import { DebatesService } from '../debates/debates.service';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import { DebateChatState, DebateTurnSchedule } from './debate-chat-state';
import { DEBATE_CHAT_STATE_STORE } from './debate-chat-state.store';
import { DebateChatPublisher } from './debate-chat.publisher';
import {
  DebateChatService,
  EXPIRE_RETRY_DELAY_MS,
} from './debate-chat.service';
import {
  DebateEndReason,
  DebatePhase,
  DebateSide,
  DebateStatus,
} from './debate-chat.types';
import { JudgeService } from '../judge/judge.service';
import { DebateTurnTimeoutScheduler } from './debate-turn-timeout.scheduler';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

describe('DebateChatService', () => {
  let service: DebateChatService;
  let publisher: { turnFinalized: jest.Mock; debateEnded: jest.Mock };
  let pipeline: { onTurnFinalized: jest.Mock; onDebateEnded: jest.Mock };
  let timeouts: { arm: jest.Mock; clear: jest.Mock; register: jest.Mock };
  let debatesService: { findInProgressIds: jest.Mock; findOneDto: jest.Mock };
  let state: DebateChatState;
  let clock: Date;
  let store: { withState: jest.Mock };

  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const NOW = new Date('2026-09-06T00:00:00.000Z');

  const opening = (side: DebateSide) => ({
    speakerId: side === DebateSide.SIDE_A ? HOST_ID : OPPONENT_ID,
    speakerSide: side,
    phase: DebatePhase.OPENING,
    round: 1,
  });

  const send = (
    side: DebateSide,
    content: string,
    clientMessageId?: string,
    phase = DebatePhase.OPENING,
  ) =>
    service.appendDraft(
      DEBATE_ID,
      opening(side).speakerId,
      { ...opening(side), phase, content },
      clientMessageId,
    );

  const finalize = (side: DebateSide, phase = DebatePhase.OPENING) =>
    service.finalizeTurn(DEBATE_ID, opening(side).speakerId, {
      ...opening(side),
      phase,
    });

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toBeInstanceOf(GeneralException);
    await expect(promise).rejects.toMatchObject({ appError: { code } });
  };

  const ALL_TURNS: [DebateSide, DebatePhase][] = [
    [DebateSide.SIDE_A, DebatePhase.OPENING],
    [DebateSide.SIDE_B, DebatePhase.OPENING],
    [DebateSide.SIDE_A, DebatePhase.CLOSING],
    [DebateSide.SIDE_B, DebatePhase.CLOSING],
  ];

  beforeEach(async () => {
    clock = NOW;
    // 저장·락은 저장소 스펙이 검증한다. 여기서는 같은 상태 객체를 계속 넘겨주는 저장소를 쓴다.
    state = DebateChatState.rehydrate({
      debateId: DEBATE_ID,
      communityId: COMMUNITY_ID,
      speakers: {
        [DebateSide.SIDE_A]: HOST_ID,
        [DebateSide.SIDE_B]: OPPONENT_ID,
      },
      // N=0 → OPENING(A,B) → CLOSING(A,B) 4턴
      schedule: new DebateTurnSchedule(0),
      limits: {
        maxContentLength: 10,
        maxTotalCharacters: 30,
        maxDurationSeconds: 180,
      },
      debateStatus: DebateStatus.IN_PROGRESS,
      startedAt: NOW,
      endedAt: null,
      expiresAt: null,
      winnerId: null,
      turns: [],
      drafts: [],
      now: () => clock,
    });
    store = {
      // 실제 저장소는 상태를 열면서 먼저 토론을 시작시킨다. 그 계약을 그대로 흉내 낸다.
      withState: jest
        .fn()
        .mockImplementation(
          (_debateId: string, work: (s: DebateChatState) => unknown) => {
            state.start();
            return Promise.resolve(work(state));
          },
        ),
    };

    publisher = { turnFinalized: jest.fn(), debateEnded: jest.fn() };
    pipeline = {
      onTurnFinalized: jest.fn().mockResolvedValue(undefined),
      onDebateEnded: jest.fn().mockResolvedValue(undefined),
    };
    timeouts = { arm: jest.fn(), clear: jest.fn(), register: jest.fn() };
    debatesService = {
      findInProgressIds: jest.fn().mockResolvedValue([]),
      findOneDto: jest.fn().mockResolvedValue({ id: DEBATE_ID }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateChatService,
        { provide: DEBATE_CHAT_STATE_STORE, useValue: store },
        { provide: DebateChatPublisher, useValue: publisher },
        { provide: JudgeService, useValue: pipeline },
        { provide: DebateTurnTimeoutScheduler, useValue: timeouts },
        { provide: DebatesService, useValue: debatesService },
      ],
    }).compile();

    service = module.get(DebateChatService);
  });

  describe('restore', () => {
    it('현재 상태 전체를 돌려주고 현재 차례의 만료 시각으로 타이머를 건다', async () => {
      const snapshot = await service.restore(DEBATE_ID);

      expect(snapshot).toMatchObject({
        debateId: DEBATE_ID,
        currentTurn: {
          phase: DebatePhase.OPENING,
          round: 1,
          turnSide: DebateSide.SIDE_A,
          maxDurationSeconds: 180,
          maxTotalCharacters: 30,
        },
        turns: [],
        draftMessages: [],
      });
      expect(timeouts.arm).toHaveBeenCalledWith(
        DEBATE_ID,
        new Date(NOW.getTime() + 180_000),
      );
    });

    it('저장된 draft가 있으면 함께 복원해 돌려준다', async () => {
      await send(DebateSide.SIDE_A, 'a');

      expect((await service.restore(DEBATE_ID)).draftMessages).toHaveLength(1);
    });
  });

  describe('appendDraft', () => {
    it('현재 발언자의 draft를 APPENDED로 저장한다(host = SIDE_A)', async () => {
      const result = await send(DebateSide.SIDE_A, '첫 발언', 'c-1');

      expect(result).toMatchObject({
        status: 'APPENDED',
        message: {
          debateId: DEBATE_ID,
          clientMessageId: 'c-1',
          speakerId: HOST_ID,
          speakerSide: DebateSide.SIDE_A,
          content: '첫 발언',
        },
      });
    });

    it('같은 clientMessageId 재전송은 DUPLICATE + 기존 메시지', async () => {
      const first = await send(DebateSide.SIDE_A, '첫 발언', 'c-1');
      const second = await send(DebateSide.SIDE_A, '다른 내용', 'c-1');

      expect(second.status).toBe('DUPLICATE');
      expect(second.message).toEqual(first.message);
    });

    it('관전자는 NOT_PARTICIPANT', async () => {
      await expectCode(
        service.appendDraft(DEBATE_ID, 'viewer', {
          ...opening(DebateSide.SIDE_A),
          speakerId: 'viewer',
          content: 'x',
        }),
        DebateChatErrorCode.NOT_PARTICIPANT.code,
      );
    });

    it('payload의 speakerId가 토큰 회원과 다르면 SPEAKER_MISMATCH', async () => {
      await expectCode(
        service.appendDraft(DEBATE_ID, HOST_ID, {
          ...opening(DebateSide.SIDE_A),
          speakerId: OPPONENT_ID,
          content: 'x',
        }),
        DebateChatErrorCode.SPEAKER_MISMATCH.code,
      );
    });

    it('차례가 아닌 참가자(opponent = SIDE_B)는 TURN_MISMATCH', async () => {
      await expectCode(
        send(DebateSide.SIDE_B, 'x'),
        DebateChatErrorCode.TURN_MISMATCH.code,
      );
    });

    it('길이 초과는 CONTENT_TOO_LONG', async () => {
      await expectCode(
        send(DebateSide.SIDE_A, 'x'.repeat(11)),
        DebateChatErrorCode.CONTENT_TOO_LONG.code,
      );
    });
  });

  describe('finalizeTurn', () => {
    it('방 전체에 finalized를 발행하고, 마지막 차례가 아니면 ended·파이프라인은 없다', async () => {
      await send(DebateSide.SIDE_A, '하나');
      await send(DebateSide.SIDE_A, '둘');

      const turn = await finalize(DebateSide.SIDE_A);

      expect(turn).toMatchObject({ sequence: 1, content: '하나\n둘' });
      expect(publisher.turnFinalized).toHaveBeenCalledWith(DEBATE_ID, turn);
      expect(publisher.debateEnded).not.toHaveBeenCalled();
      expect(pipeline.onDebateEnded).not.toHaveBeenCalled();
      // 마지막이 아니어도 확정된 턴은 매번 파이프라인으로 넘어간다.
      expect(pipeline.onTurnFinalized).toHaveBeenCalledTimes(1);
      expect(pipeline.onTurnFinalized).toHaveBeenCalledWith(turn);
    });

    it('확정 뒤에는 다음 차례의 만료 시각으로 타이머를 옮긴다', async () => {
      await send(DebateSide.SIDE_A, 'x');
      const turn = await finalize(DebateSide.SIDE_A);

      expect(timeouts.arm).toHaveBeenLastCalledWith(
        DEBATE_ID,
        new Date(new Date(turn.createdAt).getTime() + 180_000),
      );
    });

    it('draft 없이 finalize하면 TURN_EMPTY', async () => {
      await expectCode(
        finalize(DebateSide.SIDE_A),
        DebateChatErrorCode.TURN_EMPTY.code,
      );
    });

    it('마지막 차례를 확정하면 ended를 발행하고 파이프라인을 정확히 한 번 시작하며 타이머를 해제한다', async () => {
      for (const [side, phase] of ALL_TURNS) {
        await send(side, 'x', undefined, phase);
        await finalize(side, phase);
      }

      expect(publisher.turnFinalized).toHaveBeenCalledTimes(4);
      expect(publisher.debateEnded).toHaveBeenCalledTimes(1);
      expect(publisher.debateEnded).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        debateId: DEBATE_ID,
        status: DebateStatus.DEBATE_FINALIZED,
        reason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
      expect(pipeline.onTurnFinalized).toHaveBeenCalledTimes(4);
      expect(pipeline.onDebateEnded).toHaveBeenCalledTimes(1);
      expect(pipeline.onDebateEnded).toHaveBeenCalledWith(DEBATE_ID);
      expect(timeouts.arm).toHaveBeenLastCalledWith(DEBATE_ID, null);

      // 종료 뒤의 명령은 거부된다.
      await expectCode(
        send(DebateSide.SIDE_A, 'x'),
        DebateChatErrorCode.NOT_IN_PROGRESS.code,
      );
    });

    it('파이프라인이 실패해도 finalize 결과에는 영향이 없다', async () => {
      pipeline.onTurnFinalized.mockRejectedValue(new Error('llm down'));
      pipeline.onDebateEnded.mockRejectedValue(new Error('llm down'));
      let last: unknown;
      for (const [side, phase] of ALL_TURNS) {
        await send(side, 'x', undefined, phase);
        last = await finalize(side, phase);
      }
      expect(last).toMatchObject({ sequence: 4 });
    });
  });

  describe('expireTurn', () => {
    it('제한 시간이 지나지 않았으면 타이머만 다시 걸고 아무것도 알리지 않는다', async () => {
      await service.expireTurn(DEBATE_ID);

      expect(publisher.turnFinalized).not.toHaveBeenCalled();
      expect(timeouts.arm).toHaveBeenCalledWith(
        DEBATE_ID,
        new Date(NOW.getTime() + 180_000),
      );
    });

    it('제한 시간이 지나면 쓴 draft를 확정해 상대에게 넘기고 방에 finalized를 알린다', async () => {
      await send(DebateSide.SIDE_A, '쓰다 만');
      clock = new Date(NOW.getTime() + 180_000);

      await service.expireTurn(DEBATE_ID);

      expect(publisher.turnFinalized).toHaveBeenCalledWith(
        DEBATE_ID,
        expect.objectContaining({ sequence: 1, content: '쓰다 만' }),
      );
      // 토론은 끝나지 않았고, 다음 차례(SIDE_B)의 만료 시각으로 타이머가 옮겨간다.
      expect(publisher.debateEnded).not.toHaveBeenCalled();
      expect(pipeline.onDebateEnded).not.toHaveBeenCalled();
      // 시간 초과로 확정된 턴도 직접 확정과 똑같이 파이프라인으로 넘어간다.
      expect(pipeline.onTurnFinalized).toHaveBeenCalledTimes(1);
      expect(timeouts.arm).toHaveBeenLastCalledWith(
        DEBATE_ID,
        new Date(clock.getTime() + 180_000),
      );
      await expect(send(DebateSide.SIDE_B, '내 차례')).resolves.toMatchObject({
        status: 'APPENDED',
      });
    });

    it('마지막 차례가 시간 초과되면 정상 종료로 ended를 알리고 파이프라인을 시작한다', async () => {
      for (const [side, phase] of ALL_TURNS.slice(0, 3)) {
        await send(side, 'x', undefined, phase);
        await finalize(side, phase);
      }
      clock = new Date(clock.getTime() + 180_000);

      await service.expireTurn(DEBATE_ID);

      expect(publisher.debateEnded).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        debateId: DEBATE_ID,
        status: DebateStatus.DEBATE_FINALIZED,
        reason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
      expect(pipeline.onDebateEnded).toHaveBeenCalledTimes(1);
      expect(timeouts.arm).toHaveBeenLastCalledWith(DEBATE_ID, null);
    });

    it('다른 명령을 처리 중이라 락을 잡지 못하면 잠시 뒤 다시 시도한다', async () => {
      store.withState.mockRejectedValueOnce(
        new GeneralException(DebateChatErrorCode.FINALIZE_IN_PROGRESS),
      );

      await service.expireTurn(DEBATE_ID);

      expect(publisher.turnFinalized).not.toHaveBeenCalled();
      const [, deadline] = timeouts.arm.mock.calls.at(-1) as [string, Date];
      expect(deadline.getTime()).toBeLessThanOrEqual(
        Date.now() + EXPIRE_RETRY_DELAY_MS,
      );
    });
  });

  describe('부팅 복구', () => {
    it('진행 중이던 토론마다 만료 판정을 한 번씩 돌려 타이머를 다시 건다', async () => {
      debatesService.findInProgressIds.mockResolvedValue([DEBATE_ID]);

      await service.onApplicationBootstrap();

      expect(timeouts.arm).toHaveBeenCalledWith(
        DEBATE_ID,
        new Date(NOW.getTime() + 180_000),
      );
    });

    it('진행 중 토론을 읽지 못해도 부팅을 막지 않는다', async () => {
      debatesService.findInProgressIds.mockRejectedValue(new Error('db down'));

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
  describe('start', () => {
    // 상태 전이는 저장소가 상태를 열 때 하는 state.start()와 같은 것이라, 여기서는
    // 권한·상태 검사와 타이머·응답만 확인한다.
    const buildReady = () =>
      DebateChatState.rehydrate({
        debateId: DEBATE_ID,
        communityId: COMMUNITY_ID,
        speakers: {
          [DebateSide.SIDE_A]: HOST_ID,
          [DebateSide.SIDE_B]: OPPONENT_ID,
        },
        schedule: new DebateTurnSchedule(0),
        limits: {
          maxContentLength: 10,
          maxTotalCharacters: 30,
          maxDurationSeconds: 180,
        },
        debateStatus: DebateStatus.READY,
        startedAt: null,
        endedAt: null,
        expiresAt: null,
        winnerId: null,
        turns: [],
        drafts: [],
        now: () => clock,
      });

    it('아직 시작 전인 토론을 진행 중으로 바꾸고 첫 차례의 타이머를 건다', async () => {
      state = buildReady();

      await expect(service.start(DEBATE_ID, HOST_ID)).resolves.toEqual({
        id: DEBATE_ID,
      });

      expect(state.currentStatus).toBe(DebateStatus.IN_PROGRESS);
      expect(timeouts.arm).toHaveBeenCalledWith(
        DEBATE_ID,
        new Date(NOW.getTime() + 180_000),
      );
    });

    it('이미 진행 중인 토론에 다시 불러도 그대로 성공한다(멱등)', async () => {
      await expect(service.start(DEBATE_ID, HOST_ID)).resolves.toEqual({
        id: DEBATE_ID,
      });
      expect(state.currentStatus).toBe(DebateStatus.IN_PROGRESS);
    });

    it('관전자는 시작할 수 없다', async () => {
      await expectCode(
        service.start(DEBATE_ID, 'watcher-uuid'),
        DebateChatErrorCode.NOT_PARTICIPANT.code,
      );
    });

    it('이미 끝난 토론은 다시 시작할 수 없다', async () => {
      state = buildReady();
      state.start();
      // 모든 차례가 확정돼 끝난 토론.
      for (const [side, phase] of ALL_TURNS) {
        state.appendDraft(opening(side).speakerId, {
          ...opening(side),
          phase,
          content: '가',
        });
        state.finalizeTurn(opening(side).speakerId, {
          ...opening(side),
          phase,
        });
      }
      state.drainChanges();

      await expectCode(
        service.start(DEBATE_ID, HOST_ID),
        DebateErrorCode.ALREADY_ENDED.code,
      );
    });
  });

  describe('forfeit', () => {
    it('발언자가 기권하면 FAILED로 끝내고 타이머를 풀며 방에 알린다', async () => {
      await service.forfeit(DEBATE_ID, HOST_ID);

      expect(state.currentStatus).toBe(DebateStatus.FAILED);
      expect(timeouts.clear).toHaveBeenCalledWith(DEBATE_ID);
      expect(publisher.debateEnded).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        debateId: DEBATE_ID,
        status: DebateStatus.FAILED,
        reason: DebateEndReason.FORFEIT,
      });
      // 판정 파이프라인은 띄우지 않는다.
      expect(pipeline.onDebateEnded).not.toHaveBeenCalled();
    });

    it('기권 뒤 발언·확정 명령은 진행 중이 아니라는 이유로 거절된다', async () => {
      await service.forfeit(DEBATE_ID, OPPONENT_ID);

      await expectCode(
        send(DebateSide.SIDE_A, '가'),
        DebateChatErrorCode.NOT_IN_PROGRESS.code,
      );
      await expectCode(
        service.finalizeTurn(DEBATE_ID, HOST_ID, opening(DebateSide.SIDE_A)),
        DebateChatErrorCode.NOT_IN_PROGRESS.code,
      );
    });

    it('관전자는 기권할 수 없다', async () => {
      await expectCode(
        service.forfeit(DEBATE_ID, 'watcher-uuid'),
        DebateChatErrorCode.NOT_PARTICIPANT.code,
      );
      expect(publisher.debateEnded).not.toHaveBeenCalled();
    });
  });
});
