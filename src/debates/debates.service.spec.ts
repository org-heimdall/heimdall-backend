import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not, QueryFailedError } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { CommunitiesService } from '../communities/communities.service';
import { CommunityErrorCode } from '../communities/exceptions/community-error-code';
import { GeneralException } from '../common/exceptions/general.exception';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { MembersService } from '../members/members.service';
import { DebatesService } from './debates.service';
import {
  DEBATE_PENDING_REQUEST_UNIQUE,
  Debate,
  DebateTurn,
} from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';
import { DebateEventsPublisher } from './room/debate-events-publisher.interface';

describe('DebatesService', () => {
  let service: DebatesService;
  let debateRepository: {
    save: jest.Mock;
    exists: jest.Mock;
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
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

  /** pg 드라이버가 던지는 에러 모양(code=SQLSTATE, unique 위반이면 constraint=제약 이름) */
  const pgDriverError = (code: string, constraint?: string): Error =>
    Object.assign(new Error(`pg error ${code}`), { code, constraint });

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
      freetalkingRounds: 0,
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
      findOne: jest.fn().mockResolvedValue(null),
      // 기본값: 재사용할 PENDING 행도, 조건부 전이 레이스도 없는 흐름(0행 갱신).
      // 재사용 성공/전이 성공을 검증하는 테스트에서만 { affected: 1 }로 개별 override한다.
      update: jest.fn().mockResolvedValue({ affected: 0 }),
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

    it('상대 토론자가 자기 자신이면 SELF_DEBATE_FORBIDDEN 에러를 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });

      await expect(
        service.create({ ...dto, opponentId: 'host-uuid' }, 'host-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.SELF_DEBATE_FORBIDDEN,
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

    it('같은 커뮤니티에 응답 대기 중인(PENDING) 토론 요청이 있으면 REQUEST_ALREADY_PENDING 에러를 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findOne.mockResolvedValue({
        memberId: 'opponent-uuid',
        communityId: 'community-uuid',
      });
      debateRepository.findOne.mockResolvedValue(
        buildDebate({ currentTurn: DebateTurn.PENDING }),
      );

      await expect(service.create(dto, 'host-uuid')).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_ALREADY_PENDING,
      });
      expect(debateRepository.save).not.toHaveBeenCalled();
    });

    it('같은 커뮤니티에 이미 진행 중인(PENDING이 아닌) 토론이 있으면 DEBATE_ALREADY_ACTIVE 에러를 던진다', async () => {
      communitiesService.findOneOrThrow.mockResolvedValue({
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findOne.mockResolvedValue({
        memberId: 'opponent-uuid',
        communityId: 'community-uuid',
      });
      debateRepository.findOne.mockResolvedValue(
        buildDebate({ currentTurn: DebateTurn.STARTING }),
      );

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

    it('거절되어 재사용 가능한 PENDING 행이 있으면 조건부 UPDATE로 원자 점유해 되살린 행을 재사용한다', async () => {
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
      // 활성 검사(findOne)는 통과, 재사용 점유(update)는 1행 성공
      debateRepository.findOne.mockResolvedValue(null);
      debateRepository.update.mockResolvedValue({ affected: 1 });
      const revivedDebate = buildDebate({
        opponentId: 'opponent-uuid',
        opponentNickname: '상대',
        status: ResourceStatus.NORMAL,
      });
      debateRepository.findOneBy.mockResolvedValue(revivedDebate);

      const result = await service.create(dto, 'host-uuid');

      // 조건부 UPDATE가 Not(NORMAL) 조건과 리셋 값으로 호출됐는지 확인
      expect(debateRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'community-uuid',
          hostId: 'host-uuid',
          currentTurn: DebateTurn.PENDING,
          status: Not(ResourceStatus.NORMAL),
        }),
        expect.objectContaining({
          hostNickname: '호스트',
          opponentId: 'opponent-uuid',
          opponentNickname: '상대',
          currentTurn: DebateTurn.PENDING,
          status: ResourceStatus.NORMAL,
        }),
      );
      // 새 insert가 아니라 되살린 행이 재사용됐는지 확인
      expect(debateRepository.save).not.toHaveBeenCalled();
      expect(result.debateId).toBe('debate-uuid');
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

    it('재사용 점유(update)가 0행이면 신규 insert를 시도하고, 그 insert가 부분 유니크 인덱스 위반이면 REQUEST_ALREADY_PENDING 에러를 cause 없이 던지며 emit하지 않는다', async () => {
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
      // 재사용 점유 레이스에서 짐: 0행 갱신 → insert 경로로 폴스루
      debateRepository.update.mockResolvedValue({ affected: 0 });
      debateRepository.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          pgDriverError('23505', DEBATE_PENDING_REQUEST_UNIQUE),
        ),
      );

      const error = (await service
        .create(dto, 'host-uuid')
        .catch((e: unknown) => e)) as GeneralException;

      expect(error).toBeInstanceOf(GeneralException);
      expect(error.appError).toBe(DebateErrorCode.REQUEST_ALREADY_PENDING);
      expect(error.cause).toBeUndefined();
      expect(debateRepository.findOneBy).not.toHaveBeenCalled();
      expect(publisher.emitDebateRequested).not.toHaveBeenCalled();
    });

    it('매핑되지 않은 unique 위반은 그대로 전파한다', async () => {
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
      const error = new QueryFailedError(
        'INSERT',
        [],
        pgDriverError('23505', 'UQ_some_other_constraint'),
      );
      debateRepository.save.mockRejectedValue(error);

      await expect(service.create(dto, 'host-uuid')).rejects.toBe(error);
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

    it('정상 수락 시 조건부 UPDATE로 STARTING 전환하고 host에게 알린다', async () => {
      debateRepository.findOneBy.mockResolvedValue(buildDebate());
      debateRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.accept('debate-uuid', 'opponent-uuid');

      expect(result).toEqual({ debateId: 'debate-uuid' });
      expect(debateRepository.update).toHaveBeenCalledWith(
        {
          id: 'debate-uuid',
          status: ResourceStatus.NORMAL,
          currentTurn: DebateTurn.PENDING,
        },
        { currentTurn: DebateTurn.STARTING },
      );
      expect(debateRepository.save).not.toHaveBeenCalled();
      expect(publisher.emitDebateRequestAccepted).toHaveBeenCalledWith(
        'host-uuid',
        {
          debateId: 'debate-uuid',
          opponentId: 'opponent-uuid',
          opponentNickname: '상대',
        },
      );
    });

    it('사전 검증 통과 후 다른 요청이 먼저 전이시킨 레이스면(UPDATE 0행) REQUEST_NOT_PENDING 에러를 던지고 emit하지 않는다', async () => {
      debateRepository.findOneBy.mockResolvedValue(buildDebate());
      debateRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.accept('debate-uuid', 'opponent-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_NOT_PENDING,
      });
      expect(publisher.emitDebateRequestAccepted).not.toHaveBeenCalled();
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

    it('정상 거절 시 조건부 UPDATE로 soft delete하고 host에게 알린다', async () => {
      const debate = buildDebate();
      debateRepository.findOneBy.mockResolvedValue(debate);
      debateRepository.update.mockResolvedValue({ affected: 1 });

      await service.reject('debate-uuid', 'opponent-uuid');

      expect(debateRepository.update).toHaveBeenCalledWith(
        {
          id: 'debate-uuid',
          status: ResourceStatus.NORMAL,
          currentTurn: DebateTurn.PENDING,
        },
        { status: ResourceStatus.DELETED },
      );
      expect(debateRepository.save).not.toHaveBeenCalled();
      expect(publisher.emitDebateRequestRejected).toHaveBeenCalledWith(
        'host-uuid',
        {
          debateId: 'debate-uuid',
          opponentId: 'opponent-uuid',
          opponentNickname: '상대',
        },
      );
    });

    it('사전 검증 통과 후 다른 요청이 먼저 전이시킨 레이스면(UPDATE 0행) REQUEST_NOT_PENDING 에러를 던지고 emit하지 않는다', async () => {
      debateRepository.findOneBy.mockResolvedValue(buildDebate());
      debateRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.reject('debate-uuid', 'opponent-uuid'),
      ).rejects.toMatchObject({
        appError: DebateErrorCode.REQUEST_NOT_PENDING,
      });
      expect(publisher.emitDebateRequestRejected).not.toHaveBeenCalled();
    });
  });
});
