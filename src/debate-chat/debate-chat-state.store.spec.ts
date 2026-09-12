import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { Community } from '../communities/entities/community.entity';
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
            const result = await work(manager);
            calls.push('db:commit');
            return result;
          },
        ),
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
      });
    });
  });
});
