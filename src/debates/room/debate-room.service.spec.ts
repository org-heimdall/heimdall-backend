import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommunitiesService } from '../../communities/communities.service';
import { ResourceStatus } from '../../common/entities/resource-status.enum';
import { MemberCommunitiesService } from '../../member-communities/member-communities.service';
import { debateRoomName } from './debate-room-name.util';
import { DebateRoomService } from './debate-room.service';
import { DebateTimerService } from './debate-timer.service';
import { DebateEventsPublisher } from './debate-events-publisher.interface';
import { DebateMessage } from '../entities/debate-message.entity';
import { Debate, DebateTurn } from '../entities/debate.entity';
import { DebateErrorCode } from '../exceptions/debate-error-code';

describe('DebateRoomService', () => {
  let service: DebateRoomService;
  let debateRepository: { findOneBy: jest.Mock; save: jest.Mock };
  let debateMessageRepository: { create: jest.Mock; save: jest.Mock };
  let memberCommunitiesService: { findOne: jest.Mock };
  let communitiesService: { findOneOrThrow: jest.Mock };
  let publisher: DebateEventsPublisher & { emitTurnChanged: jest.Mock };

  const HOST = 'host-uuid';
  const OPPONENT = 'opponent-uuid';
  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: COMMUNITY_ID,
      hostId: HOST,
      hostNickname: '호스트',
      opponentId: OPPONENT,
      opponentNickname: '상대',
      currentTurn: DebateTurn.STARTING,
      currentSpeakerId: null,
      freetalkingRounds: 0,
      winnerId: null,
      solution: null,
      status: ResourceStatus.NORMAL,
      ...overrides,
    });

  beforeEach(async () => {
    jest.useFakeTimers();

    debateRepository = {
      findOneBy: jest.fn(),
      save: jest.fn((entity: Debate) => Promise.resolve(entity)),
    };
    debateMessageRepository = {
      create: jest.fn((entity: Partial<DebateMessage>) => entity),
      save: jest.fn((entity: Partial<DebateMessage>) =>
        Promise.resolve({ ...entity, id: 'message-uuid' }),
      ),
    };
    memberCommunitiesService = { findOne: jest.fn() };
    communitiesService = { findOneOrThrow: jest.fn() };
    publisher = {
      emitTurnChanged: jest.fn(),
      emitDebateRequested: jest.fn(),
      emitDebateRequestAccepted: jest.fn(),
      emitDebateRequestRejected: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateRoomService,
        DebateTimerService,
        { provide: getRepositoryToken(Debate), useValue: debateRepository },
        {
          provide: getRepositoryToken(DebateMessage),
          useValue: debateMessageRepository,
        },
        {
          provide: MemberCommunitiesService,
          useValue: memberCommunitiesService,
        },
        { provide: CommunitiesService, useValue: communitiesService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'DEBATE_STARTING_SECONDS' ? 10 : 180,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<DebateRoomService>(DebateRoomService);
    service.bindPublisher(publisher);

    communitiesService.findOneOrThrow.mockResolvedValue({
      debateRoundCount: 2,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('join', () => {
    it('양측 토론자가 모두 join하면 STARTING 인사 카운트다운을 시작하고, 만료되면 OPENING(host)으로 전환한다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.join(HOST, DEBATE_ID);
      // 아직 상대가 들어오지 않았으므로 카운트다운이 시작되지 않는다
      expect(debate.currentTurn).toBe(DebateTurn.STARTING);
      expect(publisher.emitTurnChanged).not.toHaveBeenCalled();

      const result = await service.join(OPPONENT, DEBATE_ID);

      expect(result.roomName).toBe(debateRoomName(DEBATE_ID));
      // DB 상태는 그대로 STARTING이고, endsAt이 채워진 turn_changed만 나간다
      expect(debate.currentTurn).toBe(DebateTurn.STARTING);
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);
      expect(publisher.emitTurnChanged).toHaveBeenCalledWith(
        debateRoomName(DEBATE_ID),
        expect.objectContaining({
          debateId: DEBATE_ID,
          turn: DebateTurn.STARTING,
          currentSpeakerId: null,
          currentSpeakerNickname: null,
          endsAt: expect.any(Number) as number,
        }),
      );

      publisher.emitTurnChanged.mockClear();
      await jest.advanceTimersByTimeAsync(10_000); // DEBATE_STARTING_SECONDS 만료

      expect(debate.currentTurn).toBe(DebateTurn.OPENING);
      expect(debate.currentSpeakerId).toBe(HOST);
      expect(publisher.emitTurnChanged).toHaveBeenCalledWith(
        debateRoomName(DEBATE_ID),
        expect.objectContaining({
          debateId: DEBATE_ID,
          turn: DebateTurn.OPENING,
          currentSpeakerId: HOST,
          currentSpeakerNickname: '호스트',
        }),
      );
    });

    it('STARTING 카운트다운 중 재-join해도 turn_changed·타이머가 중복되지 않는다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.join(HOST, DEBATE_ID);
      await service.join(OPPONENT, DEBATE_ID); // STARTING 카운트다운 시작
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);

      // 카운트다운 중 재접속(재-join)해도 다시 시작되지 않는다
      await service.join(HOST, DEBATE_ID);
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);

      // 타이머가 재예약되지 않았다면 최초 예정 시각에 정확히 한 번만 만료된다
      publisher.emitTurnChanged.mockClear();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(debate.currentTurn).toBe(DebateTurn.OPENING);
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);
    });

    it('존재하지 않는 토론이면 NOT_FOUND 에러를 던진다', async () => {
      debateRepository.findOneBy.mockResolvedValue(null);

      await expect(service.join(HOST, DEBATE_ID)).rejects.toMatchObject({
        appError: DebateErrorCode.NOT_FOUND,
      });
    });

    it('토론자가 아니어도 커뮤니티 멤버면 입장을 허용한다(관전자)', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);
      memberCommunitiesService.findOne.mockResolvedValue({
        memberId: 'spectator-uuid',
        communityId: COMMUNITY_ID,
      });

      const result = await service.join('spectator-uuid', DEBATE_ID);

      expect(result.roomName).toBe(debateRoomName(DEBATE_ID));
      // 관전자는 상태 전환에 관여하지 않는다
      expect(debate.currentTurn).toBe(DebateTurn.STARTING);
    });

    it('토론자가 아니고 커뮤니티 멤버도 아니면 NOT_COMMUNITY_MEMBER 에러를 던진다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);
      memberCommunitiesService.findOne.mockResolvedValue(null);

      await expect(
        service.join('stranger-uuid', DEBATE_ID),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.NOT_COMMUNITY_MEMBER,
      });
    });

    it('토론이 PENDING(수락 전) 상태면 토론자든 관전자든 REQUEST_NOT_ACCEPTED 에러를 던진다', async () => {
      const debate = buildDebate({ currentTurn: DebateTurn.PENDING });
      debateRepository.findOneBy.mockResolvedValue(debate);

      await expect(service.join(HOST, DEBATE_ID)).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_NOT_ACCEPTED,
      });

      await expect(
        service.join('spectator-uuid', DEBATE_ID),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_NOT_ACCEPTED,
      });
      expect(memberCommunitiesService.findOne).not.toHaveBeenCalled();
    });
  });

  describe('handleDebaterDisconnect', () => {
    it('host가 join 후 이탈하면, 이후 opponent가 join해도 STARTING 카운트다운이 시작되지 않는다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.join(HOST, DEBATE_ID);
      service.handleDebaterDisconnect(HOST, DEBATE_ID);

      await service.join(OPPONENT, DEBATE_ID);

      expect(debate.currentTurn).toBe(DebateTurn.STARTING);
      expect(publisher.emitTurnChanged).not.toHaveBeenCalled();
    });

    it('다중 탭: host가 두 소켓으로 join한 뒤 한 소켓만 끊겨도 나머지 연결이 남아 opponent join 시 카운트다운이 정상적으로 시작된다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.join(HOST, DEBATE_ID); // 탭 1
      await service.join(HOST, DEBATE_ID); // 탭 2
      service.handleDebaterDisconnect(HOST, DEBATE_ID); // 탭 1 종료(탭 2는 여전히 연결됨)

      await service.join(OPPONENT, DEBATE_ID);

      expect(debate.currentTurn).toBe(DebateTurn.STARTING);
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);
      expect(publisher.emitTurnChanged).toHaveBeenCalledWith(
        debateRoomName(DEBATE_ID),
        expect.objectContaining({ turn: DebateTurn.STARTING }),
      );
    });

    it('host가 이탈 후 재-join하면(타이머가 아직 시작되지 않았다면) STARTING 카운트다운이 정상적으로 시작된다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.join(HOST, DEBATE_ID);
      // opponent가 들어오기 전이라 아직 카운트다운은 시작되지 않은 상태에서 host가 이탈한다
      service.handleDebaterDisconnect(HOST, DEBATE_ID);
      expect(publisher.emitTurnChanged).not.toHaveBeenCalled();

      await service.join(HOST, DEBATE_ID); // 재-join
      await service.join(OPPONENT, DEBATE_ID);

      expect(debate.currentTurn).toBe(DebateTurn.STARTING);
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);
      expect(publisher.emitTurnChanged).toHaveBeenCalledWith(
        debateRoomName(DEBATE_ID),
        expect.objectContaining({ turn: DebateTurn.STARTING }),
      );
    });

    it('상태가 없는 토론이나 연결 기록이 없는 관전자 memberId로 호출해도 예외 없이 무시된다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      // 상태 자체가 없는 토론
      expect(() =>
        service.handleDebaterDisconnect(HOST, 'unknown-debate-id'),
      ).not.toThrow();

      // 상태는 있지만 연결 기록이 없는 memberId(관전자)
      await service.join(HOST, DEBATE_ID);
      expect(() =>
        service.handleDebaterDisconnect('spectator-uuid', DEBATE_ID),
      ).not.toThrow();
    });
  });

  describe('sendMessage', () => {
    it('발언자가 아니면 NOT_YOUR_TURN 에러를 던진다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      await expect(
        service.sendMessage(OPPONENT, DEBATE_ID, '안녕하세요'),
      ).rejects.toMatchObject({ appError: DebateErrorCode.NOT_YOUR_TURN });
    });

    it('STARTING 단계에서는 토론자가 발언권 검사·예산 없이 자유롭게 발언할 수 있다', async () => {
      const debate = buildDebate({ currentTurn: DebateTurn.STARTING });
      debateRepository.findOneBy.mockResolvedValue(debate);

      // 양측이 모두 join해야 STARTING 인사 발언이 허용된다
      await service.join(HOST, DEBATE_ID);
      await service.join(OPPONENT, DEBATE_ID);

      const result = await service.sendMessage(
        OPPONENT,
        DEBATE_ID,
        '안녕하세요',
      );

      expect(result.senderId).toBe(OPPONENT);
      expect(result.senderNickname).toBe('상대');
      expect(debateMessageRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ debateTurn: DebateTurn.STARTING }),
      );
    });

    it('STARTING 단계에서 토론자가 아닌 관전자가 발언하면 NOT_YOUR_TURN 에러를 던진다', async () => {
      const debate = buildDebate({ currentTurn: DebateTurn.STARTING });
      debateRepository.findOneBy.mockResolvedValue(debate);

      // 양측이 모두 join해야 STARTING 인사 발언이 허용된다
      await service.join(HOST, DEBATE_ID);
      await service.join(OPPONENT, DEBATE_ID);

      await expect(
        service.sendMessage('spectator-uuid', DEBATE_ID, '안녕하세요'),
      ).rejects.toMatchObject({ appError: DebateErrorCode.NOT_YOUR_TURN });
    });

    it('STARTING 단계에서 한쪽만 join한 상태로 발언하면 INVALID_PHASE 에러를 던지고 메시지를 저장하지 않는다', async () => {
      const debate = buildDebate({ currentTurn: DebateTurn.STARTING });
      debateRepository.findOneBy.mockResolvedValue(debate);

      // host만 입장하고 opponent는 아직 join하지 않은 상태
      await service.join(HOST, DEBATE_ID);

      await expect(
        service.sendMessage(OPPONENT, DEBATE_ID, '안녕하세요'),
      ).rejects.toMatchObject({ appError: DebateErrorCode.INVALID_PHASE });
      await expect(
        service.sendMessage(HOST, DEBATE_ID, '안녕하세요'),
      ).rejects.toMatchObject({ appError: DebateErrorCode.INVALID_PHASE });
      expect(debateMessageRepository.save).not.toHaveBeenCalled();
    });

    it('JUDGING 단계에서 발언하면 INVALID_PHASE 에러를 던진다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.JUDGING,
        currentSpeakerId: null,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      await expect(
        service.sendMessage(HOST, DEBATE_ID, '안녕하세요'),
      ).rejects.toMatchObject({ appError: DebateErrorCode.INVALID_PHASE });
    });

    it('턴 누적 글자 수가 정확히 1000자면 허용한다(경계값)', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      const result = await service.sendMessage(
        HOST,
        DEBATE_ID,
        'a'.repeat(1000),
      );

      expect(result.senderId).toBe(HOST);
      expect(result.senderNickname).toBe('호스트');
    });

    it('턴 누적 글자 수가 1000자를 초과하면 MESSAGE_BUDGET_EXCEEDED 에러를 던진다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.sendMessage(HOST, DEBATE_ID, 'a'.repeat(999));

      await expect(
        service.sendMessage(HOST, DEBATE_ID, 'bb'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.MESSAGE_BUDGET_EXCEEDED,
      });
    });

    it('발언 메시지에는 현재 단계(DebateTurn)가 기록된다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.sendMessage(HOST, DEBATE_ID, '안녕하세요');

      expect(debateMessageRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ debateTurn: DebateTurn.OPENING }),
      );
    });
  });

  describe('next_turn 전체 시퀀스', () => {
    it('debateRoundCount=2일 때 OPENING×2 → FREETALKING×4 → CLOSING×2 → JUDGING 순서로 진행되고 발언자가 교대한다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);
      communitiesService.findOneOrThrow.mockResolvedValue({
        debateRoundCount: 2,
      });

      await service.join(HOST, DEBATE_ID);
      await service.join(OPPONENT, DEBATE_ID); // STARTING 인사 카운트다운 시작
      await jest.advanceTimersByTimeAsync(10_000); // STARTING → OPENING(host)

      expect(debate.currentTurn).toBe(DebateTurn.OPENING);
      expect(debate.currentSpeakerId).toBe(HOST);

      const expectedSequence: Array<[DebateTurn, string | null]> = [
        [DebateTurn.OPENING, OPPONENT],
        [DebateTurn.FREETALKING, HOST],
        [DebateTurn.FREETALKING, OPPONENT],
        [DebateTurn.FREETALKING, HOST],
        [DebateTurn.FREETALKING, OPPONENT],
        [DebateTurn.CLOSING, HOST],
        [DebateTurn.CLOSING, OPPONENT],
        [DebateTurn.JUDGING, null],
      ];

      for (const [expectedTurn, expectedSpeaker] of expectedSequence) {
        const currentSpeaker = debate.currentSpeakerId!;
        await service.nextTurn(currentSpeaker, DEBATE_ID);
        expect(debate.currentTurn).toBe(expectedTurn);
        expect(debate.currentSpeakerId).toBe(expectedSpeaker);
      }
    });

    it('발언 차례가 아닌 사람이 next_turn을 호출하면 NOT_YOUR_TURN 에러를 던진다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      await expect(service.nextTurn(OPPONENT, DEBATE_ID)).rejects.toMatchObject(
        { appError: DebateErrorCode.NOT_YOUR_TURN },
      );
    });
  });

  describe('턴 제한시간 타이머', () => {
    it('제한시간이 지나면 자동으로 다음 턴으로 넘어간다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.join(HOST, DEBATE_ID);
      await service.join(OPPONENT, DEBATE_ID); // STARTING 인사 카운트다운 시작
      await jest.advanceTimersByTimeAsync(10_000); // STARTING → OPENING(host) 시작 + 타이머 예약

      publisher.emitTurnChanged.mockClear();

      await jest.advanceTimersByTimeAsync(180_000);

      expect(debate.currentTurn).toBe(DebateTurn.OPENING);
      expect(debate.currentSpeakerId).toBe(OPPONENT);
      expect(publisher.emitTurnChanged).toHaveBeenCalledWith(
        debateRoomName(DEBATE_ID),
        expect.objectContaining({
          turn: DebateTurn.OPENING,
          currentSpeakerId: OPPONENT,
        }),
      );
    });
  });

  describe('턴 전환 동시성 가드', () => {
    it('동시에 들어온 next_turn 요청은 직렬화되어 하나만 전환에 성공한다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      debateRepository.findOneBy.mockResolvedValue(debate);

      // await 없이 동시에 두 번 호출한 뒤 둘 다 settle시킨다
      const [first, second] = await Promise.allSettled([
        service.nextTurn(HOST, DEBATE_ID),
        service.nextTurn(HOST, DEBATE_ID),
      ]);

      // 직렬화 덕분에 첫 호출이 advance를 마친 뒤에야 두 번째 호출이 검증을 수행하므로,
      // 두 번째 호출 시점엔 이미 발언자가 바뀌어 NOT_YOUR_TURN으로 거부된다
      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('rejected');
      if (second.status === 'rejected') {
        expect(second.reason).toMatchObject({
          appError: DebateErrorCode.NOT_YOUR_TURN,
        });
      }

      expect(debate.currentTurn).toBe(DebateTurn.OPENING);
      expect(debate.currentSpeakerId).toBe(OPPONENT);
      expect(publisher.emitTurnChanged).toHaveBeenCalledTimes(1);
    });
  });

  describe('스테일 타이머 가드', () => {
    let staleService: DebateRoomService;
    let staleDebateRepository: { findOneBy: jest.Mock; save: jest.Mock };
    let staleCommunitiesService: { findOneOrThrow: jest.Mock };
    let stalePublisher: DebateEventsPublisher & { emitTurnChanged: jest.Mock };
    let mockTimerService: {
      schedule: jest.Mock<void, [string, number, () => void]>;
      cancel: jest.Mock<void, [string]>;
      has: jest.Mock<boolean, [string]>;
    };

    // 실제 DebateTimerService(setTimeout 기반)로는 스테일 콜백 발화 시점을 결정적으로 제어할 수
    // 없으므로, 이 describe에서만 schedule에 넘겨진 콜백을 직접 꺼내 호출할 수 있는 목으로 대체한다.
    beforeEach(async () => {
      mockTimerService = {
        schedule: jest.fn<void, [string, number, () => void]>(),
        cancel: jest.fn<void, [string]>(),
        has: jest.fn<boolean, [string]>().mockReturnValue(false),
      };
      staleDebateRepository = {
        findOneBy: jest.fn(),
        save: jest.fn((entity: Debate) => Promise.resolve(entity)),
      };
      staleCommunitiesService = { findOneOrThrow: jest.fn() };
      stalePublisher = {
        emitTurnChanged: jest.fn(),
        emitDebateRequested: jest.fn(),
        emitDebateRequestAccepted: jest.fn(),
        emitDebateRequestRejected: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DebateRoomService,
          {
            provide: getRepositoryToken(Debate),
            useValue: staleDebateRepository,
          },
          {
            provide: getRepositoryToken(DebateMessage),
            useValue: { create: jest.fn(), save: jest.fn() },
          },
          {
            provide: MemberCommunitiesService,
            useValue: { findOne: jest.fn() },
          },
          { provide: CommunitiesService, useValue: staleCommunitiesService },
          { provide: DebateTimerService, useValue: mockTimerService },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) =>
                key === 'DEBATE_STARTING_SECONDS' ? 10 : 180,
              ),
            },
          },
        ],
      }).compile();

      staleService = module.get<DebateRoomService>(DebateRoomService);
      staleService.bindPublisher(stalePublisher);
      staleCommunitiesService.findOneOrThrow.mockResolvedValue({
        debateRoundCount: 2,
      });
    });

    it('이미 지난 슬롯을 향해 뒤늦게 발화한 타이머 콜백은 턴을 전환시키지 않는다', async () => {
      const debate = buildDebate({
        currentTurn: DebateTurn.OPENING,
        currentSpeakerId: HOST,
      });
      staleDebateRepository.findOneBy.mockResolvedValue(debate);

      // OPENING(host)→OPENING(opponent) 전환 시 예약된 타이머 콜백을 캡처해둔다(스테일 콜백이 될 것)
      await staleService.nextTurn(HOST, DEBATE_ID);
      expect(debate.currentTurn).toBe(DebateTurn.OPENING);
      expect(debate.currentSpeakerId).toBe(OPPONENT);
      expect(mockTimerService.schedule).toHaveBeenCalledTimes(1);
      const staleCallback = mockTimerService.schedule.mock.calls[0][2];

      // 스테일 콜백이 발화하기 전에 수동 next_turn으로 슬롯이 이미 바뀐다
      await staleService.nextTurn(OPPONENT, DEBATE_ID);
      expect(debate.currentTurn).toBe(DebateTurn.FREETALKING);
      expect(debate.currentSpeakerId).toBe(HOST);

      stalePublisher.emitTurnChanged.mockClear();
      staleDebateRepository.save.mockClear();

      // 캡처해둔 스테일 콜백을 뒤늦게 호출한다: OPENING/OPPONENT 슬롯을 기대하지만 현재는
      // FREETALKING/HOST이므로 handleTurnTimeout이 조기 반환해야 한다
      staleCallback();
      await jest.advanceTimersByTimeAsync(0);

      expect(staleDebateRepository.save).not.toHaveBeenCalled();
      expect(stalePublisher.emitTurnChanged).not.toHaveBeenCalled();
      expect(debate.currentTurn).toBe(DebateTurn.FREETALKING);
      expect(debate.currentSpeakerId).toBe(HOST);
    });
  });
});
