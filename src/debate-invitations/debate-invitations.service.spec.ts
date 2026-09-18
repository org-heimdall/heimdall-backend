import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { GeneralException } from '../common/exceptions/general.exception';
import { CLOCK } from '../common/scheduling/clock';
import { CommunitiesService } from '../communities/communities.service';
import { Community } from '../communities/entities/community.entity';
import { CommunityChatPublisher } from '../community-chat/community-chat.publisher';
import { DebateChatService } from '../debate-chat/debate-chat.service';
import { DebatesService } from '../debates/debates.service';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import {
  CommunityDebateIntent,
  MemberCommunity,
} from '../member-communities/entities/member-community.entity';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { DebateInvitationExpiryScheduler } from './debate-invitation-expiry.scheduler';
import { DebateInvitationsConfig } from './debate-invitations.config';
import { DebateInvitationsService } from './debate-invitations.service';
import {
  DEBATE_INVITATION_PENDING_UNIQUE,
  DebateInvitation,
  DebateInvitationStatus,
} from './entities/debate-invitation.entity';
import { DebateInvitationErrorCode } from './exceptions/debate-invitation-error-code';

describe('DebateInvitationsService', () => {
  const COMMUNITY_ID = 'community-uuid';
  const INVITATION_ID = 'invitation-uuid';
  const DEBATE_ID = 'debate-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const NOW = new Date('2026-09-07T12:00:00.000Z');
  const TTL_SECONDS = 5;
  const EXPIRES_AT = new Date(NOW.getTime() + TTL_SECONDS * 1000);

  let service: DebateInvitationsService;
  let repository: {
    findBy: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let updateBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };
  // 조건부 UPDATE가 몇 행을 옮겼는지. 경쟁에서 진 흐름을 0으로 흉내 낸다.
  let affected: number;
  let dataSource: { transaction: jest.Mock };
  let manager: EntityManager;
  let communitiesService: { findOneOrThrow: jest.Mock; markActive: jest.Mock };
  let memberCommunitiesService: { findOne: jest.Mock };
  let membersService: { findOneOrThrow: jest.Mock };
  let debatesService: {
    findActiveByCommunity: jest.Mock;
    create: jest.Mock;
    findDetail: jest.Mock;
  };
  let debateChatService: { start: jest.Mock };
  let publisher: {
    debateRequested: jest.Mock;
    debateRequestRejected: jest.Mock;
    debateRequestExpired: jest.Mock;
    debateStarted: jest.Mock;
  };
  let expiry: { register: jest.Mock; arm: jest.Mock; clear: jest.Mock };

  const buildInvitation = (
    overrides: Partial<DebateInvitation> = {},
  ): DebateInvitation =>
    Object.assign(new DebateInvitation(), {
      id: INVITATION_ID,
      communityId: COMMUNITY_ID,
      hostMemberId: HOST_ID,
      opponentMemberId: OPPONENT_ID,
      status: DebateInvitationStatus.PENDING,
      expiresAt: EXPIRES_AT,
      respondedAt: null,
      debateId: null,
      createdAt: NOW,
      ...overrides,
    });

  const buildParticipant = (
    memberId: string,
    debateIntent = CommunityDebateIntent.OPEN_TO_DEBATE,
  ): MemberCommunity =>
    Object.assign(new MemberCommunity(), {
      memberId,
      communityId: COMMUNITY_ID,
      debateIntent,
      createdAt: NOW,
    });

  const buildDetail = () => ({
    id: DEBATE_ID,
    sideASpeaker: { id: HOST_ID },
    sideBSpeaker: { id: OPPONENT_ID },
    startedAt: NOW.toISOString(),
    expiresAt: '2026-09-07T12:12:00.000Z',
  });

  /** pg 드라이버가 던지는 에러 모양(code=SQLSTATE, unique 위반이면 constraint=제약 이름) */
  const pgDriverError = (code: string, constraint?: string): Error =>
    Object.assign(new Error(`pg error ${code}`), { code, constraint });

  beforeEach(async () => {
    affected = 1;
    updateBuilder = {
      update: jest.fn(() => updateBuilder),
      set: jest.fn(() => updateBuilder),
      where: jest.fn(() => updateBuilder),
      andWhere: jest.fn(() => updateBuilder),
      execute: jest.fn(() => Promise.resolve({ affected })),
    };
    repository = {
      findBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(buildInvitation()),
      save: jest.fn((invitation: DebateInvitation) =>
        Promise.resolve(Object.assign(invitation, { id: INVITATION_ID })),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => updateBuilder),
    };
    manager = {
      getRepository: jest.fn(() => repository),
    } as unknown as EntityManager;
    dataSource = {
      transaction: jest.fn(
        (run: (manager: EntityManager) => Promise<unknown>) => run(manager),
      ),
    };
    communitiesService = {
      findOneOrThrow: jest.fn().mockResolvedValue(
        Object.assign(new Community(), {
          id: COMMUNITY_ID,
          hostId: HOST_ID,
          topic: '커뮤니티 주제',
          debateRoundCount: 3,
        }),
      ),
      markActive: jest.fn().mockResolvedValue(undefined),
    };
    memberCommunitiesService = {
      findOne: jest.fn((memberId: string) =>
        Promise.resolve(buildParticipant(memberId)),
      ),
    };
    membersService = {
      findOneOrThrow: jest.fn().mockResolvedValue(
        Object.assign(new Member(), {
          id: HOST_ID,
          nickname: '메시',
        }),
      ),
    };
    debatesService = {
      findActiveByCommunity: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: DEBATE_ID }),
      findDetail: jest.fn().mockResolvedValue(buildDetail()),
    };
    debateChatService = { start: jest.fn().mockResolvedValue(undefined) };
    publisher = {
      debateRequested: jest.fn(),
      debateRequestRejected: jest.fn(),
      debateRequestExpired: jest.fn(),
      debateStarted: jest.fn(),
    };
    expiry = { register: jest.fn(), arm: jest.fn(), clear: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateInvitationsService,
        {
          provide: getRepositoryToken(DebateInvitation),
          useValue: repository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: CommunitiesService, useValue: communitiesService },
        {
          provide: MemberCommunitiesService,
          useValue: memberCommunitiesService,
        },
        { provide: MembersService, useValue: membersService },
        { provide: DebatesService, useValue: debatesService },
        { provide: DebateChatService, useValue: debateChatService },
        { provide: CommunityChatPublisher, useValue: publisher },
        { provide: DebateInvitationExpiryScheduler, useValue: expiry },
        {
          provide: DebateInvitationsConfig,
          useValue: { ttlSeconds: TTL_SECONDS },
        },
        { provide: CLOCK, useValue: () => NOW },
      ],
    }).compile();

    service = module.get<DebateInvitationsService>(DebateInvitationsService);
  });

  describe('start', () => {
    it('방장이 아니면 초대할 수 없다', async () => {
      await expect(
        service.start(COMMUNITY_ID, 'stranger-uuid', OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.HOST_ONLY),
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('자기 자신은 초대할 수 없다', async () => {
      await expect(
        service.start(COMMUNITY_ID, HOST_ID, HOST_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.SELF_INVITATION),
      );
    });

    it('상대가 커뮤니티 참여자가 아니면 거절한다', async () => {
      memberCommunitiesService.findOne.mockImplementation((memberId: string) =>
        Promise.resolve(
          memberId === HOST_ID ? buildParticipant(HOST_ID) : null,
        ),
      );

      await expect(
        service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY),
      );
    });

    it('방장 자신의 토론 의사가 준비 중이면 초대할 수 없다', async () => {
      memberCommunitiesService.findOne.mockImplementation((memberId: string) =>
        Promise.resolve(
          buildParticipant(
            memberId,
            memberId === HOST_ID
              ? CommunityDebateIntent.PREPARING
              : CommunityDebateIntent.OPEN_TO_DEBATE,
          ),
        ),
      );

      await expect(
        service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.HOST_NOT_OPEN_TO_DEBATE),
      );
    });

    it('상대가 토론 준비 중이면 초대할 수 없다', async () => {
      memberCommunitiesService.findOne.mockImplementation((memberId: string) =>
        Promise.resolve(
          buildParticipant(
            memberId,
            memberId === OPPONENT_ID
              ? CommunityDebateIntent.PREPARING
              : CommunityDebateIntent.OPEN_TO_DEBATE,
          ),
        ),
      );

      await expect(
        service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(
          DebateInvitationErrorCode.OPPONENT_NOT_OPEN_TO_DEBATE,
        ),
      );
    });

    it('이미 진행 중인 토론이 있으면 초대할 수 없다', async () => {
      debatesService.findActiveByCommunity.mockResolvedValue({
        id: DEBATE_ID,
      });

      await expect(
        service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.DEBATE_ALREADY_ACTIVE),
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('타이머가 돌지 못한 대기 초대를 먼저 만료시키고 새 초대를 만든다', async () => {
      const stale = buildInvitation({
        id: 'stale-uuid',
        expiresAt: new Date(NOW.getTime() - 1000),
      });
      repository.findBy.mockResolvedValue([stale]);
      repository.findOneBy.mockResolvedValue(stale);

      await service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID);

      // 만료된 초대는 EXPIRED로 옮겨지고 양쪽에 알린다.
      expect(publisher.debateRequestExpired).toHaveBeenCalledWith(
        { communityId: COMMUNITY_ID, invitationId: 'stale-uuid' },
        HOST_ID,
        OPPONENT_ID,
      );
      expect(repository.save).toHaveBeenCalled();
    });

    it('대기 중 초대가 이미 있으면(유니크 위반) ALREADY_PENDING으로 옮긴다', async () => {
      repository.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          pgDriverError('23505', DEBATE_INVITATION_PENDING_UNIQUE),
        ),
      );

      const thrown = await service
        .start(COMMUNITY_ID, HOST_ID, OPPONENT_ID)
        .catch((error: unknown) => error);

      expect(thrown).toMatchObject(
        new GeneralException(DebateInvitationErrorCode.ALREADY_PENDING),
      );
      // 원인을 도메인 사실로 완전히 환원했으므로 cause를 달지 않는다(WARN 로그 방지).
      expect((thrown as GeneralException).cause).toBeUndefined();
    });

    it('분류할 수 없는 저장 실패는 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('08006'));
      repository.save.mockRejectedValue(error);

      await expect(
        service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID),
      ).rejects.toBe(error);
    });

    it('마감은 지금+TTL이고, 타이머를 걸고 초대받은 사람에게 알린다', async () => {
      const dto = await service.start(COMMUNITY_ID, HOST_ID, OPPONENT_ID);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: COMMUNITY_ID,
          hostMemberId: HOST_ID,
          opponentMemberId: OPPONENT_ID,
          status: DebateInvitationStatus.PENDING,
          expiresAt: EXPIRES_AT,
        }),
      );
      expect(expiry.arm).toHaveBeenCalledWith(INVITATION_ID, EXPIRES_AT);
      expect(dto).toEqual({
        id: INVITATION_ID,
        communityId: COMMUNITY_ID,
        hostMemberId: HOST_ID,
        hostName: '메시',
        opponentMemberId: OPPONENT_ID,
        expiresAt: EXPIRES_AT.toISOString(),
      });
      expect(publisher.debateRequested).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        invitation: dto,
      });
    });
  });

  describe('accept', () => {
    it('초대받은 사람이 아니면 응답할 수 없다', async () => {
      await expect(
        service.accept(COMMUNITY_ID, INVITATION_ID, HOST_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.NOT_INVITEE),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('없는 초대면 NOT_FOUND를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.accept(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.NOT_FOUND),
      );
    });

    it('이미 거절된 초대면 ALREADY_RESPONDED를 던진다', async () => {
      affected = 0;
      repository.findOneBy
        .mockResolvedValueOnce(buildInvitation())
        .mockResolvedValue(
          buildInvitation({ status: DebateInvitationStatus.REJECTED }),
        );

      await expect(
        service.accept(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.ALREADY_RESPONDED),
      );
      expect(debatesService.create).not.toHaveBeenCalled();
    });

    it('마감이 지났으면 먼저 만료시켜 양쪽에 알린 뒤 EXPIRED를 던진다', async () => {
      // ACCEPTED 전이(마감 전 조건)는 실패하고, 이어지는 EXPIRED 전이(마감 후 조건)는 성공한다.
      updateBuilder.execute
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValue({ affected: 1 });

      await expect(
        service.accept(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.EXPIRED),
      );
      expect(publisher.debateRequestExpired).toHaveBeenCalledWith(
        { communityId: COMMUNITY_ID, invitationId: INVITATION_ID },
        HOST_ID,
        OPPONENT_ID,
      );
    });

    it('한 트랜잭션에서 초대를 옮기고 토론을 만든 뒤 토론을 시작한다', async () => {
      const detail = await service.accept(
        COMMUNITY_ID,
        INVITATION_ID,
        OPPONENT_ID,
      );

      // 토론 생성은 호출자의 트랜잭션에 참여한다.
      expect(debatesService.create).toHaveBeenCalledWith(
        {
          communityId: COMMUNITY_ID,
          topic: '커뮤니티 주제',
          sideASpeakerId: HOST_ID,
          sideBSpeakerId: OPPONENT_ID,
          rebuttalQuestionRounds: 3,
        },
        OPPONENT_ID,
        manager,
      );
      expect(repository.update).toHaveBeenCalledWith(INVITATION_ID, {
        debateId: DEBATE_ID,
      });
      expect(communitiesService.markActive).toHaveBeenCalledWith(
        COMMUNITY_ID,
        manager,
      );
      // 만료 타이머를 풀고 토론을 곧바로 시작한다.
      expect(expiry.clear).toHaveBeenCalledWith(INVITATION_ID);
      expect(debateChatService.start).toHaveBeenCalledWith(
        DEBATE_ID,
        OPPONENT_ID,
      );
      expect(detail).toEqual(buildDetail());
      expect(publisher.debateStarted).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        debateId: DEBATE_ID,
        sideASpeaker: { id: HOST_ID },
        sideBSpeaker: { id: OPPONENT_ID },
        startedAt: NOW.toISOString(),
        expiresAt: '2026-09-07T12:12:00.000Z',
      });
    });

    it('토론 생성이 실패하면 초대 전이도 함께 되돌아간다(같은 트랜잭션)', async () => {
      const failure = new GeneralException(
        DebateErrorCode.SPEAKER_NOT_IN_COMMUNITY,
      );
      debatesService.create.mockRejectedValue(failure);

      await expect(
        service.accept(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID),
      ).rejects.toBe(failure);
      expect(debateChatService.start).not.toHaveBeenCalled();
      expect(publisher.debateStarted).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('초대받은 사람이 아니면 거절할 수 없다', async () => {
      await expect(
        service.reject(COMMUNITY_ID, INVITATION_ID, HOST_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.NOT_INVITEE),
      );
    });

    it('대기 중 초대를 거절하면 타이머를 풀고 방장에게만 알린다', async () => {
      await service.reject(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID);

      expect(expiry.clear).toHaveBeenCalledWith(INVITATION_ID);
      expect(publisher.debateRequestRejected).toHaveBeenCalledWith(
        {
          communityId: COMMUNITY_ID,
          invitationId: INVITATION_ID,
          opponentMemberId: OPPONENT_ID,
        },
        HOST_ID,
      );
    });

    it('이미 수락된 초대는 거절할 수 없다', async () => {
      affected = 0;
      repository.findOneBy
        .mockResolvedValueOnce(buildInvitation())
        .mockResolvedValue(
          buildInvitation({ status: DebateInvitationStatus.ACCEPTED }),
        );

      await expect(
        service.reject(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.ALREADY_RESPONDED),
      );
      expect(publisher.debateRequestRejected).not.toHaveBeenCalled();
    });

    it('이미 만료된 초대는 EXPIRED를 던진다', async () => {
      affected = 0;
      repository.findOneBy
        .mockResolvedValueOnce(buildInvitation())
        .mockResolvedValue(
          buildInvitation({ status: DebateInvitationStatus.EXPIRED }),
        );

      await expect(
        service.reject(COMMUNITY_ID, INVITATION_ID, OPPONENT_ID),
      ).rejects.toMatchObject(
        new GeneralException(DebateInvitationErrorCode.EXPIRED),
      );
    });
  });

  describe('expire', () => {
    it('실제로 만료시킨 흐름만 양쪽에 알린다', async () => {
      await service.expire(INVITATION_ID);

      expect(publisher.debateRequestExpired).toHaveBeenCalledWith(
        { communityId: COMMUNITY_ID, invitationId: INVITATION_ID },
        HOST_ID,
        OPPONENT_ID,
      );
    });

    it('이미 응답된 초대면(전이 실패) 아무 일도 하지 않는다', async () => {
      affected = 0;

      await service.expire(INVITATION_ID);

      expect(publisher.debateRequestExpired).not.toHaveBeenCalled();
    });

    it('없는 초대면 아무 일도 하지 않는다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await service.expire(INVITATION_ID);

      expect(updateBuilder.execute).not.toHaveBeenCalled();
      expect(publisher.debateRequestExpired).not.toHaveBeenCalled();
    });

    it('예외를 밖으로 던지지 않는다(타이머 콜백)', async () => {
      repository.findOneBy.mockRejectedValue(new Error('DB 장애'));

      await expect(service.expire(INVITATION_ID)).resolves.toBeUndefined();
      expect(publisher.debateRequestExpired).not.toHaveBeenCalled();
    });
  });

  describe('onApplicationBootstrap', () => {
    it('대기 중 초대의 만료 타이머를 다시 건다', async () => {
      repository.findBy.mockResolvedValue([
        buildInvitation({ id: 'invitation-1' }),
        buildInvitation({ id: 'invitation-2' }),
      ]);

      await service.onApplicationBootstrap();

      expect(repository.findBy).toHaveBeenCalledWith({
        status: DebateInvitationStatus.PENDING,
      });
      expect(expiry.arm).toHaveBeenCalledWith('invitation-1', EXPIRES_AT);
      expect(expiry.arm).toHaveBeenCalledWith('invitation-2', EXPIRES_AT);
    });

    it('복구에 실패해도 부팅을 막지 않는다', async () => {
      repository.findBy.mockRejectedValue(new Error('DB 장애'));

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(expiry.arm).not.toHaveBeenCalled();
    });
  });

  describe('findActive', () => {
    it('진행 중인 토론이 없으면 null을 돌려준다', async () => {
      await expect(
        service.findActive(COMMUNITY_ID, OPPONENT_ID),
      ).resolves.toBeNull();
      expect(debatesService.findDetail).not.toHaveBeenCalled();
    });

    it('진행 중인 토론이 있으면 요청자 기준 상세를 돌려준다', async () => {
      debatesService.findActiveByCommunity.mockResolvedValue({ id: DEBATE_ID });

      await expect(
        service.findActive(COMMUNITY_ID, OPPONENT_ID),
      ).resolves.toEqual(buildDetail());
      expect(debatesService.findDetail).toHaveBeenCalledWith(
        DEBATE_ID,
        OPPONENT_ID,
      );
    });
  });
});
