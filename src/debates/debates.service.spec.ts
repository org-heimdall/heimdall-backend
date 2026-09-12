import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunitiesService } from '../communities/communities.service';
import { Community } from '../communities/entities/community.entity';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { MemberCommunity } from '../member-communities/entities/member-community.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { MembersService } from '../members/members.service';
import { DebatesService } from './debates.service';
import { DebatePhase, DebateSide } from './debate-turn';
import { CreateDebateDto } from './dto/create-debate.dto';
import { DebateMessageLike } from './entities/debate-message-like.entity';
import { DebateMessage } from './entities/debate-message.entity';
import { DebateStatus } from './entities/debate-status.enum';
import { Debate, DebateTurn } from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';

describe('DebatesService', () => {
  let service: DebatesService;
  let debateRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let messageRepository: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let likeRepository: { createQueryBuilder: jest.Mock };
  let communitiesService: { findOneOrThrow: jest.Mock };
  let memberCommunitiesService: {
    findOne: jest.Mock;
    findParticipants: jest.Mock;
  };
  let membersService: { findByIds: jest.Mock };

  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const NOW = new Date('2026-09-07T12:00:00.000Z');

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: COMMUNITY_ID,
      topic: 'AI 규제, 필요한가?',
      // N=0 → OPENING(A,B) → CLOSING(A,B) 4턴
      rebuttalQuestionRounds: 0,
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      debateStatus: DebateStatus.IN_PROGRESS,
      startedAt: NOW,
      endedAt: null,
      expiresAt: null,
      winnerId: null,
      createdAt: NOW,
      status: ResourceStatus.NORMAL,
      community: Object.assign(new Community(), {
        id: COMMUNITY_ID,
        debateRoundCount: 0,
        status: ResourceStatus.NORMAL,
      }),
      ...overrides,
    });

  const buildMember = (id: string, nickname: string): Member =>
    Object.assign(new Member(), {
      id,
      nickname,
      profileImageUrl: null,
      rating: 0,
      status: ResourceStatus.NORMAL,
    });

  const buildParticipant = (memberId: string): MemberCommunity =>
    Object.assign(new MemberCommunity(), {
      memberId,
      communityId: COMMUNITY_ID,
      opinion: `${memberId}의 주장`,
      reasons: ['근거'],
    });

  const buildMessage = (sequence: number, memberId: string): DebateMessage =>
    Object.assign(new DebateMessage(), {
      id: `message-${sequence}`,
      memberId,
      debateId: DEBATE_ID,
      body: `발언 ${sequence}`,
      sequence,
      createdAt: new Date(NOW.getTime() + sequence * 60_000),
      status: ResourceStatus.NORMAL,
    });

  // 집계 쿼리는 raw 결과만 쓰므로 getRawMany만 흉내 내는 최소 빌더를 준다.
  const queryBuilderReturning = (rows: unknown[]) => {
    const builder: Record<string, jest.Mock> = {};
    for (const method of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn().mockResolvedValue(rows);
    return builder;
  };

  const validRequest = (): CreateDebateDto => ({
    communityId: COMMUNITY_ID,
    topic: 'AI 규제, 필요한가?',
    sideASpeakerId: HOST_ID,
    sideBSpeakerId: OPPONENT_ID,
    rebuttalQuestionRounds: 3,
  });

  beforeEach(async () => {
    debateRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((entity: object) => entity),
      save: jest.fn((entity: object) =>
        Promise.resolve(
          Object.assign(new Debate(), entity, {
            id: DEBATE_ID,
            createdAt: NOW,
            startedAt: null,
            endedAt: null,
            expiresAt: null,
          }),
        ),
      ),
    };
    messageRepository = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => queryBuilderReturning([])),
    };
    likeRepository = {
      createQueryBuilder: jest.fn(() => queryBuilderReturning([])),
    };
    communitiesService = {
      findOneOrThrow: jest.fn().mockResolvedValue(
        Object.assign(new Community(), {
          id: COMMUNITY_ID,
          topic: '커뮤니티 주제',
          debateRoundCount: 5,
          status: ResourceStatus.NORMAL,
        }),
      ),
    };
    memberCommunitiesService = {
      findOne: jest.fn().mockResolvedValue(buildParticipant(HOST_ID)),
      findParticipants: jest
        .fn()
        .mockResolvedValue([
          buildParticipant(HOST_ID),
          buildParticipant(OPPONENT_ID),
        ]),
    };
    membersService = {
      findByIds: jest
        .fn()
        .mockResolvedValue([
          buildMember(HOST_ID, '메시'),
          buildMember(OPPONENT_ID, '호날두'),
        ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebatesService,
        { provide: getRepositoryToken(Debate), useValue: debateRepository },
        {
          provide: getRepositoryToken(DebateMessage),
          useValue: messageRepository,
        },
        {
          provide: getRepositoryToken(DebateMessageLike),
          useValue: likeRepository,
        },
        { provide: CommunitiesService, useValue: communitiesService },
        {
          provide: MemberCommunitiesService,
          useValue: memberCommunitiesService,
        },
        { provide: MembersService, useValue: membersService },
      ],
    }).compile();

    service = module.get<DebatesService>(DebatesService);
  });

  describe('findOneOrThrow', () => {
    it('토론을 커뮤니티와 함께 조회한다', async () => {
      const debate = buildDebate();
      debateRepository.findOne.mockResolvedValue(debate);

      await expect(service.findOneOrThrow(DEBATE_ID)).resolves.toBe(debate);
      expect(debateRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: DEBATE_ID,
          status: ResourceStatus.NORMAL,
          community: { status: ResourceStatus.NORMAL },
        },
        relations: { community: true },
      });
    });

    it('soft-delete된 토론(또는 커뮤니티)은 조회 결과에서 빠져 NOT_FOUND를 던진다', async () => {
      // status 필터가 걸린 조회는 삭제된 행을 돌려주지 않는다.
      debateRepository.findOne.mockResolvedValue(null);

      await expect(service.findOneOrThrow(DEBATE_ID)).rejects.toMatchObject(
        new GeneralException(DebateErrorCode.NOT_FOUND),
      );
    });
  });

  describe('findInProgressIds', () => {
    it('진행 중이고 삭제되지 않은 토론의 id만 돌려준다', async () => {
      debateRepository.find.mockResolvedValue([
        buildDebate({ id: 'debate-1' }),
        buildDebate({ id: 'debate-2' }),
      ]);

      await expect(service.findInProgressIds()).resolves.toEqual([
        'debate-1',
        'debate-2',
      ]);
      expect(debateRepository.find).toHaveBeenCalledWith({
        select: { id: true },
        where: {
          status: ResourceStatus.NORMAL,
          debateStatus: DebateStatus.IN_PROGRESS,
        },
      });
    });
  });

  describe('findAll', () => {
    it('삭제되지 않은 토론과 커뮤니티만 최근 생성 순으로 읽는다', async () => {
      debateRepository.find.mockResolvedValue([buildDebate()]);

      const debates = await service.findAll();

      expect(debates).toHaveLength(1);
      expect(debateRepository.find).toHaveBeenCalledWith({
        where: {
          status: ResourceStatus.NORMAL,
          community: { status: ResourceStatus.NORMAL },
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('status를 주면 그 진행 단계만 조회한다', async () => {
      debateRepository.find.mockResolvedValue([]);

      await service.findAll(DebateStatus.COMPLETED);

      expect(debateRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            debateStatus: DebateStatus.COMPLETED,
          }) as unknown,
        }),
      );
    });

    it('토론마다 확정 턴 수를 한 번에 집계해 현재 차례를 채운다', async () => {
      debateRepository.find.mockResolvedValue([buildDebate()]);
      const lastTurnAt = new Date(NOW.getTime() + 120_000);
      messageRepository.createQueryBuilder.mockReturnValue(
        queryBuilderReturning([
          {
            debateId: DEBATE_ID,
            turnCount: '2',
            lastTurnCreatedAt: lastTurnAt,
          },
        ]),
      );

      const [debate] = await service.findAll();

      expect(debate).toMatchObject({
        currentPhase: DebatePhase.CLOSING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: lastTurnAt.toISOString(),
      });
      // 목록 전체를 한 번의 집계로 읽는다(토론마다 조회하지 않는다).
      expect(messageRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('토론이 없으면 집계 쿼리를 아예 실행하지 않는다', async () => {
      debateRepository.find.mockResolvedValue([]);

      await expect(service.findAll()).resolves.toEqual([]);
      expect(messageRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('findTurns', () => {
    beforeEach(() => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
    });

    it('확정된 턴만 sequence 순으로 읽고 phase·편을 파생한다', async () => {
      messageRepository.find.mockResolvedValue([
        buildMessage(1, HOST_ID),
        buildMessage(2, OPPONENT_ID),
      ]);

      const turns = await service.findTurns(DEBATE_ID);

      expect(turns).toMatchObject([
        {
          sequence: 1,
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          likeCount: 0,
          dislikeCount: 0,
        },
        { sequence: 2, speakerSide: DebateSide.SIDE_B, likeCount: 0 },
      ]);
      expect(messageRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { sequence: 'ASC' },
        }),
      );
    });

    it('턴별 좋아요·싫어요 수를 집계해 붙인다', async () => {
      messageRepository.find.mockResolvedValue([buildMessage(1, HOST_ID)]);
      likeRepository.createQueryBuilder.mockReturnValue(
        queryBuilderReturning([
          { messageId: 'message-1', likeCount: '3', dislikeCount: '1' },
        ]),
      );

      const [turn] = await service.findTurns(DEBATE_ID);

      expect(turn).toMatchObject({ likeCount: 3, dislikeCount: 1 });
    });

    it('없는 토론이면 NOT_FOUND를 던진다', async () => {
      debateRepository.findOne.mockResolvedValue(null);

      await expect(service.findTurns(DEBATE_ID)).rejects.toMatchObject(
        new GeneralException(DebateErrorCode.NOT_FOUND),
      );
    });
  });

  describe('findDetail', () => {
    beforeEach(() => {
      debateRepository.findOne.mockResolvedValue(buildDebate());
    });

    it('발언자 프로필·기조 발언과 요청한 회원의 편을 채운다', async () => {
      const detail = await service.findDetail(DEBATE_ID, OPPONENT_ID);

      expect(detail).toMatchObject({
        id: DEBATE_ID,
        sideASpeakerId: HOST_ID,
        sideASpeaker: {
          id: HOST_ID,
          displayName: '메시',
          claim: `${HOST_ID}의 주장`,
          reasons: ['근거'],
        },
        sideBSpeaker: { id: OPPONENT_ID, displayName: '호날두' },
        viewerSide: DebateSide.SIDE_B,
      });
    });

    it('발언자가 아닌 회원의 viewerSide는 null이다', async () => {
      const detail = await service.findDetail(DEBATE_ID, 'watcher-uuid');

      expect(detail.viewerSide).toBeNull();
    });

    it('발언자 회원이 삭제됐으면 MEMBER.NOT_FOUND를 던진다', async () => {
      membersService.findByIds.mockResolvedValue([
        buildMember(HOST_ID, '메시'),
      ]);

      await expect(
        service.findDetail(DEBATE_ID, HOST_ID),
      ).rejects.toMatchObject(new GeneralException(MemberErrorCode.NOT_FOUND));
    });
  });

  describe('create', () => {
    it('요청의 주제·라운드 수를 토론이 직접 갖고 READY로 저장한다', async () => {
      const created = await service.create(validRequest(), HOST_ID);

      expect(debateRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: COMMUNITY_ID,
          topic: 'AI 규제, 필요한가?',
          // 커뮤니티의 debateRoundCount(5)가 아니라 요청 값을 쓴다.
          rebuttalQuestionRounds: 3,
          hostId: HOST_ID,
          hostNickname: '메시',
          opponentId: OPPONENT_ID,
          opponentNickname: '호날두',
          debateStatus: DebateStatus.READY,
        }),
      );
      expect(created).toMatchObject({
        id: DEBATE_ID,
        status: DebateStatus.READY,
        rebuttalQuestionRounds: 3,
        currentPhase: null,
        startedAt: null,
      });
    });

    it('없는 커뮤니티면 COMMUNITY.NOT_FOUND를 던진다', async () => {
      communitiesService.findOneOrThrow.mockRejectedValue(
        new GeneralException(CommunityErrorCode.NOT_FOUND),
      );

      await expect(
        service.create(validRequest(), HOST_ID),
      ).rejects.toMatchObject(
        new GeneralException(CommunityErrorCode.NOT_FOUND),
      );
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('커뮤니티 참여자가 아니면 토론을 만들 수 없다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue(null);

      await expect(
        service.create(validRequest(), 'stranger-uuid'),
      ).rejects.toMatchObject(
        new GeneralException(DebateErrorCode.CREATE_FORBIDDEN),
      );
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('발언자가 그 커뮤니티의 참여자가 아니면 거절한다', async () => {
      memberCommunitiesService.findParticipants.mockResolvedValue([
        buildParticipant(HOST_ID),
      ]);

      await expect(
        service.create(validRequest(), HOST_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY),
      );
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('없는 회원을 발언자로 지정하면 MEMBER.NOT_FOUND를 던진다', async () => {
      membersService.findByIds.mockResolvedValue([
        buildMember(HOST_ID, '메시'),
      ]);

      await expect(
        service.create(validRequest(), HOST_ID),
      ).rejects.toMatchObject(new GeneralException(MemberErrorCode.NOT_FOUND));
    });
  });
});
