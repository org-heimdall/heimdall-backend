import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { Community } from '../communities/entities/community.entity';
import { DebateOutcomeKind } from '../debate-outcomes/debate-outcome.types';
import { DebateEndReason } from '../debates/entities/debate-end-reason.enum';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { DebateStatus } from '../debates/entities/debate-status.enum';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { RedisDebateChatStateStore } from './debate-chat-state.store';
import { DebateChatState } from './debate-chat-state';
import { DebatePhase, DebateSide } from './debate-chat.types';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

describe('RedisDebateChatStateStore', () => {
  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const NOW = new Date('2026-09-06T00:00:00.000Z');

  // Redis·DB 호출이 일어난 순서. "DB 커밋 뒤에 draft를 지운다"를 검증하는 데 쓴다.
  let calls: string[];
  let redis: {
    set: jest.Mock;
    eval: jest.Mock;
    lrange: jest.Mock;
    hgetall: jest.Mock;
    pipeline: jest.Mock;
  };
  let pipelineCommands: unknown[][];
  let messageRepository: { find: jest.Mock; insert: jest.Mock };
  let debateRepository: { update: jest.Mock };
  let debatesService: { findOneOrThrow: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let outcomes: { applyWithin: jest.Mock };
  // 트랜잭션 콜백에 넘긴 manager. 결과 반영이 같은 트랜잭션에 참여하는지 확인하는 데 쓴다.
  let txManager: unknown;
  let store: RedisDebateChatStateStore;

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: COMMUNITY_ID,
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      topic: 'AI 규제, 필요한가?',
      // N=0 → OPENING(A,B) → CLOSING(A,B) 4턴
      rebuttalQuestionRounds: 0,
      debateStatus: DebateStatus.IN_PROGRESS,
      startedAt: NOW,
      endedAt: null,
      expiresAt: null,
      winnerId: null,
      status: ResourceStatus.NORMAL,
      community: Object.assign(new Community(), {
        id: COMMUNITY_ID,
        debateRoundCount: 0,
        status: ResourceStatus.NORMAL,
      }),
      ...overrides,
    });

  const buildMessage = (
    sequence: number,
    memberId: string,
    body: string,
  ): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: `message-${sequence}`,
      memberId,
      debateId: DEBATE_ID,
      body,
      sequence,
      createdAt: NOW,
      status: ResourceStatus.NORMAL,
    });

  const openingCommand = {
    speakerId: HOST_ID,
    speakerSide: DebateSide.SIDE_A,
    phase: DebatePhase.OPENING,
    round: 1,
  };

  beforeEach(() => {
    calls = [];
    pipelineCommands = [];

    const pipeline = {
      rpush: (...args: unknown[]) => {
        pipelineCommands.push(['rpush', ...args]);
        return pipeline;
      },
      hset: (...args: unknown[]) => {
        pipelineCommands.push(['hset', ...args]);
        return pipeline;
      },
      expire: (...args: unknown[]) => {
        pipelineCommands.push(['expire', ...args]);
        return pipeline;
      },
      del: (...args: unknown[]) => {
        pipelineCommands.push(['del', ...args]);
        return pipeline;
      },
      exec: jest.fn().mockImplementation(() => {
        calls.push('redis:exec');
        return Promise.resolve([]);
      }),
    };

    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockImplementation(() => {
        calls.push('redis:unlock');
        return Promise.resolve(1);
      }),
      lrange: jest.fn().mockResolvedValue([]),
      hgetall: jest.fn().mockResolvedValue({}),
      pipeline: jest.fn().mockReturnValue(pipeline),
    };

    messageRepository = {
      find: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockImplementation(() => {
        calls.push('db:insert');
        return Promise.resolve({});
      }),
    };
    debateRepository = {
      update: jest.fn().mockImplementation(() => {
        calls.push('db:update');
        return Promise.resolve({});
      }),
    };
    debatesService = {
      findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()),
    };
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          async (work: (manager: unknown) => Promise<unknown>) => {
            calls.push('db:begin');
            const manager = {
              getRepository: (entity: unknown) =>
                entity === DebateMessage ? messageRepository : debateRepository,
            };
            txManager = manager;
            const result = await work(manager);
            calls.push('db:commit');
            return result;
          },
        ),
    };

    outcomes = {
      applyWithin: jest.fn().mockImplementation(() => {
        calls.push('db:outcome');
        return Promise.resolve();
      }),
    };

    store = new RedisDebateChatStateStore(
      redis as never,
      debatesService as never,
      messageRepository as never,
      dataSource as never,
      {
        limits: {
          maxContentLength: 10,
          maxTotalCharacters: 30,
          maxDurationSeconds: 180,
        },
      },
      outcomes as never,
    );
  });

  describe('락', () => {
    it('토론 단위 락을 NX EX로 잡고 작업이 끝나면 내 토큰일 때만 푼다', async () => {
      await store.withState(DEBATE_ID, (state) => state.snapshot());

      expect(redis.set).toHaveBeenCalledWith(
        `debate-chat:${DEBATE_ID}:lock`,
        expect.any(String),
        'EX',
        expect.any(Number),
        'NX',
      );
      const [, token] = redis.set.mock.calls[0] as string[];
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        `debate-chat:${DEBATE_ID}:lock`,
        token,
      );
    });

    it('락을 끝내 잡지 못하면 FINALIZE_IN_PROGRESS로 거절한다', async () => {
      redis.set.mockResolvedValue(null);

      await expect(
        store.withState(DEBATE_ID, (state) => state.snapshot()),
      ).rejects.toMatchObject({
        appError: { code: DebateChatErrorCode.FINALIZE_IN_PROGRESS.code },
      });
      expect(debatesService.findOneOrThrow).not.toHaveBeenCalled();
    });

    it('작업이 실패해도 락은 풀고 아무것도 저장하지 않는다', async () => {
      await expect(
        store.withState(DEBATE_ID, () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(pipelineCommands).toEqual([]);
    });
  });

  describe('복원', () => {
    it('확정 턴은 soft-delete되지 않고 sequence가 있는 행만 순서대로 읽는다', async () => {
      await store.withState(DEBATE_ID, (state) => state.snapshot());

      expect(messageRepository.find).toHaveBeenCalledWith({
        where: {
          debateId: DEBATE_ID,
          status: ResourceStatus.NORMAL,
          sequence: expect.objectContaining({ _type: 'not' }) as unknown,
        },
        order: { sequence: 'ASC' },
      });
    });

    it('확정 턴의 phase/round는 스케줄에서, 편은 발언자에서 파생한다', async () => {
      messageRepository.find.mockResolvedValue([
        buildMessage(1, HOST_ID, '찬성합니다'),
        buildMessage(2, OPPONENT_ID, '반대합니다'),
      ]);

      const snapshot = await store.withState(DEBATE_ID, (state) =>
        state.snapshot(),
      );

      expect(snapshot.turns).toEqual([
        {
          id: 'message-1',
          debateId: DEBATE_ID,
          speakerId: HOST_ID,
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          round: 1,
          content: '찬성합니다',
          createdAt: NOW.toISOString(),
          sequence: 1,
        },
        {
          id: 'message-2',
          debateId: DEBATE_ID,
          speakerId: OPPONENT_ID,
          speakerSide: DebateSide.SIDE_B,
          phase: DebatePhase.OPENING,
          round: 1,
          content: '반대합니다',
          createdAt: NOW.toISOString(),
          sequence: 2,
        },
      ]);
      // 두 턴이 확정됐으므로 현재 차례는 세 번째(CLOSING/SIDE_A).
      expect(snapshot.currentTurn).toMatchObject({
        phase: DebatePhase.CLOSING,
        turnSide: DebateSide.SIDE_A,
      });
    });

    it('현재 차례의 draft와 토론 단위 중복 방지 기록을 Redis에서 읽는다', async () => {
      messageRepository.find.mockResolvedValue([
        buildMessage(1, HOST_ID, '찬성합니다'),
      ]);
      const draft = {
        id: 'draft-1',
        debateId: DEBATE_ID,
        clientMessageId: 'c-1',
        speakerId: OPPONENT_ID,
        speakerSide: DebateSide.SIDE_B,
        phase: DebatePhase.OPENING,
        round: 1,
        content: '이어서',
        createdAt: NOW.toISOString(),
      };
      redis.lrange.mockResolvedValue([JSON.stringify(draft)]);
      redis.hgetall.mockResolvedValue({ 'c-1': JSON.stringify(draft) });

      const snapshot = await store.withState(DEBATE_ID, (state) =>
        state.snapshot(),
      );

      // 확정 턴이 1개이므로 draft 키는 차례 인덱스 1을 쓴다.
      expect(redis.lrange).toHaveBeenCalledWith(
        `debate-chat:${DEBATE_ID}:drafts:1`,
        0,
        -1,
      );
      expect(redis.hgetall).toHaveBeenCalledWith(
        `debate-chat:${DEBATE_ID}:cmids`,
      );
      expect(snapshot.draftMessages).toEqual([draft]);
    });

    it('상대 발언자가 없는 토론은 OPPONENT_MISSING', async () => {
      debatesService.findOneOrThrow.mockResolvedValue(
        buildDebate({ opponentId: null, opponentNickname: null }),
      );

      await expect(
        store.withState(DEBATE_ID, (state) => state.snapshot()),
      ).rejects.toBeInstanceOf(GeneralException);
    });
  });

  describe('토론 시작', () => {
    it('아직 시작 전인 토론은 첫 접근에서 IN_PROGRESS와 시작 시각을 기록한다', async () => {
      debatesService.findOneOrThrow.mockResolvedValue(
        buildDebate({ debateStatus: null, startedAt: null }),
      );

      const snapshot = await store.withState(DEBATE_ID, (state) =>
        state.snapshot(),
      );

      expect(debateRepository.update).toHaveBeenCalledWith(
        DEBATE_ID,
        expect.objectContaining({ debateStatus: DebateStatus.IN_PROGRESS }),
      );
      expect(snapshot.currentTurn).not.toBeNull();
    });

    it('이미 진행 중인 토론은 다시 시작하지 않는다', async () => {
      await store.withState(DEBATE_ID, (state) => state.snapshot());

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('변경 반영', () => {
    it('draft 추가는 차례별 리스트와 중복 방지 해시에 TTL과 함께 쌓는다', async () => {
      await store.withState(DEBATE_ID, (state) =>
        state.appendDraft(
          HOST_ID,
          { ...openingCommand, content: '첫 발언' },
          'c-1',
        ),
      );

      const draftsKey = `debate-chat:${DEBATE_ID}:drafts:0`;
      const cmidsKey = `debate-chat:${DEBATE_ID}:cmids`;
      expect(pipelineCommands).toEqual([
        ['rpush', draftsKey, expect.stringContaining('첫 발언')],
        ['expire', draftsKey, 1800],
        ['hset', cmidsKey, 'c-1', expect.stringContaining('첫 발언')],
        ['expire', cmidsKey, 1800],
      ]);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('턴 확정은 한 트랜잭션으로 저장하고, 커밋된 뒤에야 그 차례의 draft를 지운다', async () => {
      await store.withState(DEBATE_ID, (state) => {
        state.appendDraft(HOST_ID, { ...openingCommand, content: '첫 발언' });
        return state.finalizeTurn(HOST_ID, openingCommand);
      });

      expect(messageRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: HOST_ID,
          debateId: DEBATE_ID,
          body: '첫 발언',
          sequence: 1,
        }),
      );
      // 마지막 차례가 아니므로 토론 행은 그대로 둔다.
      expect(debateRepository.update).not.toHaveBeenCalled();
      expect(calls).toEqual([
        'db:begin',
        'db:insert',
        'db:commit',
        'redis:exec',
        'redis:unlock',
      ]);
      expect(pipelineCommands).toContainEqual([
        'del',
        `debate-chat:${DEBATE_ID}:drafts:0`,
      ]);
    });

    it('마지막 차례를 확정하면 확정 턴과 토론 종료를 같은 트랜잭션에 담는다', async () => {
      messageRepository.find.mockResolvedValue([
        buildMessage(1, HOST_ID, 'a'),
        buildMessage(2, OPPONENT_ID, 'b'),
        buildMessage(3, HOST_ID, 'c'),
      ]);
      const closing = {
        speakerId: OPPONENT_ID,
        speakerSide: DebateSide.SIDE_B,
        phase: DebatePhase.CLOSING,
        round: 1,
      };

      await store.withState(DEBATE_ID, (state: DebateChatState) => {
        state.appendDraft(OPPONENT_ID, { ...closing, content: '마무리' });
        return state.finalizeTurn(OPPONENT_ID, closing);
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        'db:begin',
        'db:insert',
        'db:update',
        'db:commit',
        'redis:exec',
        'redis:unlock',
      ]);
      expect(debateRepository.update).toHaveBeenCalledWith(DEBATE_ID, {
        debateStatus: DebateStatus.DEBATE_FINALIZED,
        startedAt: NOW,
        endedAt: expect.any(Date) as unknown,
        expiresAt: null,
        winnerId: null,
        endReason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
      // 판정으로 넘어가는 종료는 여기서 결과를 반영하지 않는다.
      expect(outcomes.applyWithin).not.toHaveBeenCalled();
    });

    it('기권은 토론 종료와 결과 반영(보상·알림·커뮤니티)을 같은 트랜잭션에 담는다', async () => {
      await store.withState(DEBATE_ID, (state) => state.forfeit(HOST_ID));

      expect(debateRepository.update).toHaveBeenCalledWith(
        DEBATE_ID,
        expect.objectContaining({
          debateStatus: DebateStatus.FAILED,
          winnerId: OPPONENT_ID,
          endReason: DebateEndReason.FORFEIT,
        }),
      );
      expect(outcomes.applyWithin).toHaveBeenCalledWith(txManager, {
        debateId: DEBATE_ID,
        communityId: COMMUNITY_ID,
        kind: DebateOutcomeKind.FORFEIT,
        status: DebateStatus.FAILED,
        reason: DebateEndReason.FORFEIT,
        winnerId: OPPONENT_ID,
      });
      expect(calls).toEqual([
        'db:begin',
        'db:update',
        'db:outcome',
        'db:commit',
        'redis:exec',
        'redis:unlock',
      ]);
    });

    it('마지막 차례에서 한쪽이 한 번도 발언하지 않았으면 전체 시간 초과 결과를 같은 트랜잭션에 반영한다', async () => {
      // SIDE_B는 확정 턴이 모두 비어 있다.
      messageRepository.find.mockResolvedValue([
        buildMessage(1, HOST_ID, 'a'),
        buildMessage(2, OPPONENT_ID, ''),
        buildMessage(3, HOST_ID, 'c'),
      ]);
      // 마지막 차례(CLOSING/SIDE_B)의 제한 시간이 지난 뒤
      const late = new Date(NOW.getTime() + 181_000);
      jest.useFakeTimers({ now: late, doNotFake: ['setTimeout'] });

      try {
        await store.withState(DEBATE_ID, (state) => state.expireTurn());
      } finally {
        jest.useRealTimers();
      }

      expect(outcomes.applyWithin).toHaveBeenCalledWith(
        txManager,
        expect.objectContaining({
          kind: DebateOutcomeKind.TOTAL_TIMEOUT,
          reason: DebateEndReason.TOTAL_TIME_EXPIRED,
          winnerId: HOST_ID,
        }),
      );
      expect(calls).toEqual([
        'db:begin',
        'db:insert',
        'db:update',
        'db:outcome',
        'db:commit',
        'redis:exec',
        'redis:unlock',
      ]);
    });

    it('결과 반영이 실패하면 커밋이 실패하고 draft도 지우지 않는다', async () => {
      outcomes.applyWithin.mockRejectedValue(new Error('reward failed'));

      await expect(
        store.withState(DEBATE_ID, (state) => state.forfeit(HOST_ID)),
      ).rejects.toThrow('reward failed');
      expect(calls).not.toContain('db:commit');
      expect(calls).not.toContain('redis:exec');
      // 락은 풀어 다음 명령이 진행될 수 있게 한다.
      expect(calls).toContain('redis:unlock');
    });
  });
});
