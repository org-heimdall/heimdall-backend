import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { MembersService } from '../members/members.service';
import { DebatesService } from './debates.service';
import { Debate, DebateTurn } from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';
import { DebateEventsPublisher } from './room/debate-events-publisher.interface';

describe('DebatesService', () => {
  let service: DebatesService;
  let debateRepository: {
    save: jest.Mock;
    exists: jest.Mock;
    findOneBy: jest.Mock;
  };
  let communitiesService: {
    findOneOrThrow: jest.Mock;
    getMemberKeynote: jest.Mock;
  };
  let memberCommunitiesService: { findOne: jest.Mock };
  let membersService: { findOneOrThrow: jest.Mock };
  let publisher: DebateEventsPublisher & {
    emitDebateRequested: jest.Mock;
    emitDebateRequestAccepted: jest.Mock;
    emitDebateRequestRejected: jest.Mock;
  };

  const dto = { communityId: 'community-uuid', opponentId: 'opponent-uuid' };

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: 'debate-uuid',
      communityId: 'community-uuid',
      hostId: 'host-uuid',
      hostNickname: '호스트',
      opponentId: 'opponent-uuid',
      opponentNickname: '상대',
      currentTurn: DebateTurn.PENDING,
      currentSpeakerId: null,
      freetalkingRound: 0,
      winnerId: null,
      solution: null,
      status: ResourceStatus.NORMAL,
      ...overrides,
    });

  beforeEach(async () => {
    debateRepository = {
      save: jest.fn((entity: Debate) =>
        Promise.resolve(
          Object.assign(entity, {
            id: entity.id ?? 'debate-uuid',
            createdAt: entity.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
          }),
        ),
      ),
      exists: jest.fn().mockResolvedValue(false),
      findOneBy: jest.fn(),
    };
    communitiesService = {
      findOneOrThrow: jest.fn(),
      getMemberKeynote: jest.fn().mockResolvedValue({
        opinion: '찬성',
        reasons: [],
      }),
    };
    memberCommunitiesService = { findOne: jest.fn() };
    membersService = { findOneOrThrow: jest.fn() };
    publisher = {
      emitTurnChanged: jest.fn(),
      emitDebateRequested: jest.fn(),
      emitDebateRequestAccepted: jest.fn(),
      emitDebateRequestRejected: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebatesService,
        { provide: getRepositoryToken(Debate), useValue: debateRepository },
        { provide: CommunitiesService, useValue: communitiesService },
        {
          provide: MemberCommunitiesService,
          useValue: memberCommunitiesService,
        },
        { provide: MembersService, useValue: membersService },
      ],
    }).compile();

    service = module.get<DebatesService>(DebatesService);
    service.bindPublisher(publisher);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('호스트가 아니면 NOT_HOST 에러를 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'other-uuid',
      });

      await expect(service.create(dto, 'host-uuid')).rejects.toMatchObject({
        appError: DebateErrorCode.NOT_HOST,
      });
      expect(memberCommunitiesService.findOne).not.toHaveBeenCalled();
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('상대가 커뮤니티 멤버가 아니면 OPPONENT_NOT_IN_COMMUNITY 에러를 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findOne.mockResolvedValue(null);

      await expect(service.create(dto, 'host-uuid')).rejects.toMatchObject({
        appError: DebateErrorCode.OPPONENT_NOT_IN_COMMUNITY,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('상대가 기조발언을 작성하지 않았으면 OPPONENT_KEYNOTE_REQUIRED 에러를 cause 없이 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findOne.mockResolvedValue({
        memberId: 'opponent-uuid',
        communityId: 'community-uuid',
      });
      communitiesService.getMemberKeynote.mockRejectedValue(
        new GeneralException(CommunityErrorCode.KEYNOTE_NOT_FOUND),
      );

      const error = (await service
        .create(dto, 'host-uuid')
        .catch((e: unknown) => e)) as GeneralException;

      expect(error).toBeInstanceOf(GeneralException);
      expect(error.appError).toBe(DebateErrorCode.OPPONENT_KEYNOTE_REQUIRED);
      expect(error.cause).toBeUndefined();
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('같은 커뮤니티에 이미 진행 중인 토론이 있으면 DEBATE_ALREADY_ACTIVE 에러를 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findOne.mockResolvedValue({
        memberId: 'opponent-uuid',
        communityId: 'community-uuid',
      });
      debateRepository.exists.mockResolvedValue(true);

      await expect(service.create(dto, 'host-uuid')).rejects.toMatchObject({
        appError: DebateErrorCode.DEBATE_ALREADY_ACTIVE,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('검증을 통과하면 PENDING 상태의 토론을 생성하고 상대에게 debate_requested를 발행한다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findOne.mockResolvedValue({
        memberId: 'opponent-uuid',
        communityId: 'community-uuid',
      });
      membersService.findOneOrThrow.mockImplementation((memberId: string) =>
        Promise.resolve({
          id: memberId,
          nickname: memberId === 'host-uuid' ? '호스트' : '상대',
        }),
      );

      const result = await service.create(dto, 'host-uuid');

      expect(debateRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'community-uuid',
          hostId: 'host-uuid',
          hostNickname: '호스트',
          opponentId: 'opponent-uuid',
          opponentNickname: '상대',
          currentTurn: DebateTurn.PENDING,
        }),
      );
      expect(result.debateId).toBe('debate-uuid');
      expect(result.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(publisher.emitDebateRequested).toHaveBeenCalledWith(
        'opponent-uuid',
        expect.objectContaining({
          debateId: 'debate-uuid',
          communityId: 'community-uuid',
          hostId: 'host-uuid',
          hostNickname: '호스트',
        }),
      );
    });
  });

  describe('accept', () => {
    it('존재하지 않는 토론이면 NOT_FOUND 에러를 던진다', async () => {
      debateRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.accept('debate-uuid', 'opponent-uuid'),
      ).rejects.toMatchObject({ appError: DebateErrorCode.NOT_FOUND });
    });

    it('요청받은 당사자가 아니면 NOT_REQUEST_OPPONENT 에러를 던진다', async () => {
      debateRepository.findOneBy.mockResolvedValue(buildDebate());

      await expect(
        service.accept('debate-uuid', 'stranger-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.NOT_REQUEST_OPPONENT,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('PENDING 상태가 아니면 REQUEST_NOT_PENDING 에러를 던진다', async () => {
      debateRepository.findOneBy.mockResolvedValue(
        buildDebate({ currentTurn: DebateTurn.STARTING }),
      );

      await expect(
        service.accept('debate-uuid', 'opponent-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_NOT_PENDING,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('정상 수락 시 STARTING으로 전환하고 host에게 알린다', async () => {
      debateRepository.findOneBy.mockResolvedValue(buildDebate());

      const result = await service.accept('debate-uuid', 'opponent-uuid');

      expect(result).toEqual({ debateId: 'debate-uuid' });
      expect(debateRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentTurn: DebateTurn.STARTING }),
      );
      expect(publisher.emitDebateRequestAccepted).toHaveBeenCalledWith(
        'host-uuid',
        {
          debateId: 'debate-uuid',
          opponentId: 'opponent-uuid',
          opponentNickname: '상대',
        },
      );
    });
  });

  describe('reject', () => {
    it('요청받은 당사자가 아니면 NOT_REQUEST_OPPONENT 에러를 던진다', async () => {
      debateRepository.findOneBy.mockResolvedValue(buildDebate());

      await expect(
        service.reject('debate-uuid', 'stranger-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.NOT_REQUEST_OPPONENT,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('PENDING 상태가 아니면 REQUEST_NOT_PENDING 에러를 던진다', async () => {
      debateRepository.findOneBy.mockResolvedValue(
        buildDebate({ currentTurn: DebateTurn.STARTING }),
      );

      await expect(
        service.reject('debate-uuid', 'opponent-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_NOT_PENDING,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('정상 거절 시 soft delete하고 host에게 알린다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);

      await service.reject('debate-uuid', 'opponent-uuid');

      expect(debate.status).toBe(ResourceStatus.DELETED);
      expect(debateRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ResourceStatus.DELETED }),
      );
      expect(publisher.emitDebateRequestRejected).toHaveBeenCalledWith(
        'host-uuid',
        {
          debateId: 'debate-uuid',
          opponentId: 'opponent-uuid',
          opponentNickname: '상대',
        },
      );
    });
  });
});
