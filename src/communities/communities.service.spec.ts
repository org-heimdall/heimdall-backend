import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunitiesService } from './communities.service';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { Community, CommunityState } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { MembersService } from '../members/members.service';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { CommunityErrorCode } from './exceptions/community-error-code';
import {
  CommunityDebateIntent,
  MemberCommunity,
} from '../member-communities/entities/member-community.entity';
import { CommunityMemberRole } from './dto/community-member.dto';
import { MAX_PARTICIPANT_PREVIEWS } from './dto/community.dto';

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let communityRepository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let themeRepository: {
    find: jest.Mock;
    findBy: jest.Mock;
    findOneBy: jest.Mock;
  };
  let communityFavoriteRepository: {
    upsert: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let membersService: { findByIds: jest.Mock; findOneOrThrow: jest.Mock };
  let memberCommunitiesService: {
    create: jest.Mock;
    deleteByCommunity: jest.Mock;
    findParticipants: jest.Mock;
    findParticipantsByCommunities: jest.Mock;
    findOne: jest.Mock;
    updateDebateIntent: jest.Mock;
    upsertKeynote: jest.Mock;
    insertIfAbsent: jest.Mock;
    deleteOne: jest.Mock;
  };
  let queryBuilder: {
    where: jest.Mock;
    orderBy: jest.Mock;
    andWhere: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
    getCount: jest.Mock;
  };
  // 트랜잭션 콜백에 넘길 가짜 manager. 엔티티별 트랜잭션 레포지토리를 캐싱해 반환한다.
  let txRepos: Map<
    unknown,
    { create: jest.Mock; save: jest.Mock; delete: jest.Mock }
  >;
  let manager: {
    getRepository: jest.Mock;
    increment: jest.Mock;
    decrement: jest.Mock;
  };

  const buildMember = (overrides: Partial<Member> = {}): Member =>
    Object.assign(new Member(), {
      id: 'member-uuid',
      email: 'a@b.com',
      password: 'hash',
      nickname: '헤임달',
      gender: null,
      age: null,
      profileImageUrl: null,
      socialCredit: 0,
      rating: 0,
      status: ResourceStatus.NORMAL,
      ...overrides,
    });

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn(() => queryBuilder),
      andWhere: jest.fn(() => queryBuilder),
      orderBy: jest.fn(() => queryBuilder),
      skip: jest.fn(() => queryBuilder),
      take: jest.fn(() => queryBuilder),
      getMany: jest.fn(),
      getCount: jest.fn(),
    };
    communityRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOneBy: jest.fn(),
      save: jest.fn((e) => Promise.resolve(e)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    themeRepository = {
      find: jest.fn(),
      findBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
    };
    communityFavoriteRepository = {
      upsert: jest.fn().mockResolvedValue({ identifiers: [] }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    txRepos = new Map();
    manager = {
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      decrement: jest.fn().mockResolvedValue({ affected: 1 }),
      getRepository: jest.fn((entity: unknown) => {
        if (!txRepos.has(entity)) {
          txRepos.set(entity, {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            create: jest.fn((e) => e),
            // TypeORM save처럼 저장된 엔티티에 DB 생성값(id, createdAt)을 채워 반환한다
            save: jest.fn((e: { createdAt?: Date }) =>
              Promise.resolve({
                ...e,
                id: 'new-community',
                createdAt: e.createdAt ?? new Date('2026-09-07T11:59:00.000Z'),
              }),
            ),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          });
        }
        return txRepos.get(entity);
      }),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };

    membersService = { findByIds: jest.fn(), findOneOrThrow: jest.fn() };
    memberCommunitiesService = {
      create: jest.fn(),
      deleteByCommunity: jest.fn(),
      findParticipants: jest.fn(),
      findParticipantsByCommunities: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      updateDebateIntent: jest.fn(),
      upsertKeynote: jest.fn(),
      insertIfAbsent: jest.fn().mockResolvedValue(true),
      deleteOne: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        {
          provide: getRepositoryToken(Community),
          useValue: communityRepository,
        },
        { provide: getRepositoryToken(Theme), useValue: themeRepository },
        {
          provide: getRepositoryToken(CommunityFavorite),
          useValue: communityFavoriteRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: MembersService, useValue: membersService },
        {
          provide: MemberCommunitiesService,
          useValue: memberCommunitiesService,
        },
      ],
    }).compile();

    service = module.get<CommunitiesService>(CommunitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /** 조회 결과로 돌아올 법한 커뮤니티 엔티티 한 건 */
  const buildCommunity = (overrides: Partial<Community> = {}): Community =>
    Object.assign(new Community(), {
      id: 'community-uuid',
      themeId: 'theme-uuid',
      state: CommunityState.WAITING,
      title: 'AI 규제 토론방',
      isPublic: true,
      hostId: 'host-uuid',
      memberCount: 2,
      topic: 'AI 규제, 필요한가?',
      debateRoundCount: 3,
      communityLink: null,
      createdAt: new Date('2026-09-07T11:59:00.000Z'),
      status: ResourceStatus.NORMAL,
      ...overrides,
    });

  /** 커뮤니티 참여 행 한 건 */
  const buildParticipation = (
    overrides: Partial<MemberCommunity> = {},
  ): MemberCommunity =>
    Object.assign(new MemberCommunity(), {
      id: 'participation-uuid',
      memberId: 'host-uuid',
      communityId: 'community-uuid',
      isOnline: false,
      debateIntent: CommunityDebateIntent.PREPARING,
      opinion: null,
      reasons: null,
      createdAt: new Date('2026-09-07T11:59:00.000Z'),
      updatedAt: new Date('2026-09-07T11:59:00.000Z'),
      ...overrides,
    });

  describe('findAll', () => {
    it('조회한 커뮤니티를 계약 스키마의 배열로 돌려준다', async () => {
      queryBuilder.getMany.mockResolvedValue([buildCommunity()]);
      themeRepository.findBy.mockResolvedValue([
        { id: 'theme-uuid', name: 'POLITICS' },
      ]);
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue([
        buildParticipation({ opinion: '찬성', reasons: ['이유1'] }),
        buildParticipation({ id: 'p2', memberId: 'member-uuid' }),
      ]);
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'host-uuid', nickname: '호스트' }),
        buildMember({ id: 'member-uuid', nickname: '참여자' }),
      ]);

      const result = await service.findAll('member-uuid', 1, 10);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'community-uuid',
        title: 'AI 규제 토론방',
        topic: 'AI 규제, 필요한가?',
        category: 'POLITICS',
        status: CommunityState.WAITING,
        rounds: 3,
        isPublic: true,
        hostClaim: '찬성',
        hostReasons: ['이유1'],
        host: {
          id: 'host-uuid',
          displayName: '호스트',
          profileImageUrl: null,
        },
        memberCount: 2,
        createdAt: '2026-09-07T11:59:00.000Z',
        // 요청자는 방장이 아니지만 참여 중이다
        isOwnedByCurrentUser: false,
        isJoined: true,
      });
      expect(result[0].participantPreviews).toEqual([
        { id: 'host-uuid', displayName: '호스트', profileImageUrl: null },
        { id: 'member-uuid', displayName: '참여자', profileImageUrl: null },
      ]);
    });

    it('방장의 프로필 이미지를 host에 함께 싣는다', async () => {
      queryBuilder.getMany.mockResolvedValue([buildCommunity()]);
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue([
        buildParticipation(),
      ]);
      membersService.findByIds.mockResolvedValue([
        buildMember({
          id: 'host-uuid',
          nickname: '호스트',
          profileImageUrl: 'https://cdn.example.com/profile/1.png',
        }),
      ]);

      const result = await service.findAll('member-uuid', 1, 10);

      expect(result[0].host).toEqual({
        id: 'host-uuid',
        displayName: '호스트',
        profileImageUrl: 'https://cdn.example.com/profile/1.png',
      });
    });

    it('방장이 탈퇴해 회원 조회에서 빠지면 이름과 이미지를 비운다', async () => {
      queryBuilder.getMany.mockResolvedValue([buildCommunity()]);
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue(
        [],
      );
      membersService.findByIds.mockResolvedValue([]);

      const result = await service.findAll('member-uuid', 1, 10);

      expect(result[0].host).toEqual({
        id: 'host-uuid',
        displayName: '',
        profileImageUrl: null,
      });
    });

    it('참여자 미리보기는 최대 5명까지만 싣는다', async () => {
      const participants = Array.from({ length: 7 }, (_, index) =>
        buildParticipation({ id: `p${index}`, memberId: `m${index}` }),
      );
      queryBuilder.getMany.mockResolvedValue([buildCommunity()]);
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue(
        participants,
      );
      membersService.findByIds.mockResolvedValue(
        participants.map((participation) =>
          buildMember({ id: participation.memberId }),
        ),
      );

      const result = await service.findAll('member-uuid', 1, 10);

      expect(result[0].participantPreviews).toHaveLength(
        MAX_PARTICIPANT_PREVIEWS,
      );
      // 미리보기에 필요한 회원만 읽는다(참여자 전원이 아니라 방장 + 정원)
      expect(membersService.findByIds).toHaveBeenCalledWith([
        'host-uuid',
        'm0',
        'm1',
        'm2',
        'm3',
        'm4',
      ]);
    });

    it('요청자가 방장이면 isOwnedByCurrentUser가 true다', async () => {
      queryBuilder.getMany.mockResolvedValue([buildCommunity()]);
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue([
        buildParticipation(),
      ]);
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'host-uuid' }),
      ]);

      const result = await service.findAll('host-uuid', 1, 10);

      expect(result[0].isOwnedByCurrentUser).toBe(true);
      expect(result[0].isJoined).toBe(true);
    });

    it('커뮤니티가 없으면 참여자·테마를 조회하지 않고 빈 배열을 돌려준다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await expect(service.findAll('member-uuid', 1, 10)).resolves.toEqual([]);

      expect(
        memberCommunitiesService.findParticipantsByCommunities,
      ).not.toHaveBeenCalled();
      expect(themeRepository.findBy).not.toHaveBeenCalled();
    });

    it('정렬 기준을 memberCount ASC 컬럼으로 매핑한다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid', 1, 10, CommunitySort.MEMBER_ASC);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'community.memberCount',
        'ASC',
      );
    });

    it('themeId가 있으면 community.themeId 필터를 적용한다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid', 1, 10, undefined, 'theme-uuid');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'community.themeId = :themeId',
        { themeId: 'theme-uuid' },
      );
    });

    it('themeId가 없으면 테마 필터를 적용하지 않는다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid', 1, 10);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('status=NORMAL 필터를 적용해 soft-delete된 커뮤니티를 제외한다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid', 1, 10);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'community.status = :status',
        { status: ResourceStatus.NORMAL },
      );
    });

    it('size가 없으면 자르지 않고 전체를 돌려준다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid');

      expect(queryBuilder.skip).not.toHaveBeenCalled();
      expect(queryBuilder.take).not.toHaveBeenCalled();
    });

    it('size만 주면 첫 페이지로 잘라 준다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid', undefined, 10);

      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('page와 size를 함께 주면 그 묶음만 잘라 준다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.findAll('member-uuid', 3, 10);

      expect(queryBuilder.skip).toHaveBeenCalledWith(20);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findOne', () => {
    it('목록과 같은 스키마로 커뮤니티 1건을 돌려준다', async () => {
      communityRepository.findOneBy.mockResolvedValue(buildCommunity());
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue([
        buildParticipation({ opinion: '찬성', reasons: ['이유1'] }),
      ]);
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'host-uuid', nickname: '호스트' }),
      ]);

      const result = await service.findOne('community-uuid', 'other-uuid');

      expect(result).toMatchObject({
        id: 'community-uuid',
        hostClaim: '찬성',
        isOwnedByCurrentUser: false,
        // 참여 행이 방장뿐이므로 요청자는 참여 중이 아니다
        isJoined: false,
      });
    });

    it('없는 커뮤니티면 NOT_FOUND 에러를 던진다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findOne('없는-uuid', 'member-uuid'),
      ).rejects.toMatchObject({ appError: CommunityErrorCode.NOT_FOUND });
    });
  });

  describe('create', () => {
    const dto = {
      title: 'AI 규제 토론방',
      topic: 'AI 규제',
      category: 'POLITICS',
      rounds: 3,
      isPublic: true,
      hostClaim: '찬성',
      hostReasons: ['이유1'],
    };

    beforeEach(() => {
      themeRepository.findOneBy.mockResolvedValue({
        id: 'theme-uuid',
        name: 'POLITICS',
      });
      communityRepository.findOneBy.mockResolvedValue(
        buildCommunity({ id: 'new-community' }),
      );
      memberCommunitiesService.findParticipantsByCommunities.mockResolvedValue(
        [],
      );
      membersService.findByIds.mockResolvedValue([]);
    });

    it('트랜잭션으로 community/호스트 keynote를 생성한다', async () => {
      const host = buildMember({ id: 'host-uuid', nickname: '호스트' });
      membersService.findOneOrThrow.mockResolvedValue(host);

      const result = await service.create(dto, 'host-uuid');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);

      const communityTxRepo = txRepos.get(Community)!;
      // Community.open 팩토리가 만든 초기 불변식 엔티티를 그대로 save 한다
      expect(communityTxRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          // 저장 전 in-memory 엔티티도 NORMAL이어야 isDeleted()가 오판하지 않는다
          status: ResourceStatus.NORMAL,
          state: CommunityState.WAITING,
          hostId: 'host-uuid',
          // category(테마 이름)를 themeId로 해석해 저장한다
          themeId: 'theme-uuid',
          memberCount: 1,
          title: 'AI 규제 토론방',
          topic: 'AI 규제',
          isPublic: true,
          debateRoundCount: 3,
          communityLink: null,
        }),
      );
      // 호스트의 member_community(기조발언)를 같은 트랜잭션 manager로 생성한다
      expect(memberCommunitiesService.create).toHaveBeenCalledWith(
        'host-uuid',
        'new-community',
        '찬성',
        ['이유1'],
        manager,
      );
      expect(result.id).toBe('new-community');
    });

    it('호스트 회원이 없으면 NOT_FOUND 에러를 던진다', async () => {
      membersService.findOneOrThrow.mockRejectedValue(
        new GeneralException(MemberErrorCode.NOT_FOUND),
      );

      await expect(service.create(dto, 'host-uuid')).rejects.toMatchObject({
        appError: MemberErrorCode.NOT_FOUND,
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('테마 목록에 없는 category면 THEME_NOT_FOUND 에러를 던지고 생성하지 않는다', async () => {
      membersService.findOneOrThrow.mockResolvedValue(
        buildMember({ id: 'host-uuid' }),
      );
      themeRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ ...dto, category: '없는카테고리' }, 'host-uuid'),
      ).rejects.toMatchObject({
        appError: CommunityErrorCode.THEME_NOT_FOUND,
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('host가 아니면 DELETE_FORBIDDEN 에러를 던진다', async () => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'other-uuid',
      });

      await expect(
        service.delete('community-uuid', 'not-host'),
      ).rejects.toMatchObject({
        appError: CommunityErrorCode.DELETE_FORBIDDEN,
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('존재하지 않으면 NOT_FOUND 에러를 던진다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.delete('community-uuid', 'host-uuid'),
      ).rejects.toMatchObject({ appError: CommunityErrorCode.NOT_FOUND });
    });

    it('host면 커뮤니티를 물리 삭제가 아니라 status=DELETED로 soft-delete한다', async () => {
      const community = Object.assign(new Community(), {
        id: 'community-uuid',
        hostId: 'host-uuid',
        status: ResourceStatus.NORMAL,
      });
      communityRepository.findOneBy.mockResolvedValue(community);

      await service.delete('community-uuid', 'host-uuid');

      // 상태만 전환해 저장한다
      expect(communityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'community-uuid',
          status: ResourceStatus.DELETED,
        }),
      );
      // 자식 리소스와 참여 행은 건드리지 않는다(물리 삭제 없음)
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(memberCommunitiesService.deleteByCommunity).not.toHaveBeenCalled();
    });
  });

  describe('findCommunityMembers', () => {
    const JOINED_AT = new Date('2026-09-07T11:59:00.000Z');

    const buildParticipant = (
      memberId: string,
      opinion: string | null,
      debateIntent = CommunityDebateIntent.PREPARING,
    ): MemberCommunity =>
      Object.assign(new MemberCommunity(), {
        memberId,
        communityId: 'community-uuid',
        opinion,
        reasons: null,
        debateIntent,
        createdAt: JOINED_AT,
      });

    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findParticipants.mockResolvedValue([
        buildParticipant(
          'host-uuid',
          null,
          CommunityDebateIntent.OPEN_TO_DEBATE,
        ),
        buildParticipant('keynote-uuid', '있음'),
        buildParticipant('normal-uuid', null),
      ]);
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'host-uuid' }),
        buildMember({ id: 'keynote-uuid' }),
        buildMember({ id: 'normal-uuid' }),
      ]);
    });

    it('계약 모양(role·debateIntent·joinedAt)으로 참여자를 돌려준다', async () => {
      const result = await service.findCommunityMembers('community-uuid');

      const byId = Object.fromEntries(result.map((r) => [r.id, r]));
      expect(byId['host-uuid'].role).toBe(CommunityMemberRole.HOST);
      expect(byId['host-uuid'].debateIntent).toBe(
        CommunityDebateIntent.OPEN_TO_DEBATE,
      );
      expect(byId['host-uuid'].joinedAt).toBe(JOINED_AT.toISOString());
      expect(byId['keynote-uuid'].role).toBe(CommunityMemberRole.MEMBER);
      expect(byId['normal-uuid'].debateIntent).toBe(
        CommunityDebateIntent.PREPARING,
      );
    });

    it('memberType 필터(host/기조발언 여부 분류)를 적용한다', async () => {
      const result = await service.findCommunityMembers(
        'community-uuid',
        CommunityMemberType.KEYNOTE_MEMBER,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('keynote-uuid');
    });

    it('회원이 삭제돼 조회되지 않는 참여 행은 목록에서 빠진다', async () => {
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'host-uuid' }),
      ]);

      const result = await service.findCommunityMembers('community-uuid');

      expect(result.map((r) => r.id)).toEqual(['host-uuid']);
    });
  });

  describe('updateMyDebateIntent', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'host-uuid',
      });
    });

    it('참여 중이 아니면 PARTICIPANT_NOT_FOUND를 던진다', async () => {
      memberCommunitiesService.updateDebateIntent.mockResolvedValue(null);

      await expect(
        service.updateMyDebateIntent(
          'community-uuid',
          'member-uuid',
          CommunityDebateIntent.OPEN_TO_DEBATE,
        ),
      ).rejects.toMatchObject({
        appError: CommunityErrorCode.PARTICIPANT_NOT_FOUND,
      });
    });

    it('갱신된 참여 행으로 계약 모양의 참여자를 만든다(방장이면 role=HOST)', async () => {
      memberCommunitiesService.updateDebateIntent.mockResolvedValue(
        Object.assign(new MemberCommunity(), {
          memberId: 'host-uuid',
          communityId: 'community-uuid',
          debateIntent: CommunityDebateIntent.OPEN_TO_DEBATE,
          createdAt: new Date('2026-09-07T11:59:00.000Z'),
        }),
      );
      membersService.findOneOrThrow.mockResolvedValue(
        buildMember({ id: 'host-uuid' }),
      );

      const result = await service.updateMyDebateIntent(
        'community-uuid',
        'host-uuid',
        CommunityDebateIntent.OPEN_TO_DEBATE,
      );

      expect(memberCommunitiesService.updateDebateIntent).toHaveBeenCalledWith(
        'host-uuid',
        'community-uuid',
        CommunityDebateIntent.OPEN_TO_DEBATE,
      );
      expect(result).toMatchObject({
        id: 'host-uuid',
        role: CommunityMemberRole.HOST,
        debateIntent: CommunityDebateIntent.OPEN_TO_DEBATE,
        joinedAt: '2026-09-07T11:59:00.000Z',
      });
    });
  });

  describe('markActive', () => {
    it('토론이 시작되면 삭제되지 않은 커뮤니티를 ACTIVE로 옮긴다', async () => {
      await service.markActive('community-uuid');

      expect(communityRepository.update).toHaveBeenCalledWith(
        { id: 'community-uuid', status: ResourceStatus.NORMAL },
        { state: CommunityState.ACTIVE },
      );
    });
  });

  describe('getMemberKeynote', () => {
    it('행이 없으면 PARTICIPANT_NOT_FOUND 에러를 던진다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue(null);

      await expect(
        service.getMemberKeynote('community-uuid', 'member-uuid'),
      ).rejects.toMatchObject({
        appError: CommunityErrorCode.PARTICIPANT_NOT_FOUND,
      });
    });

    it('기조발언 미작성(opinion=null)이면 KEYNOTE_NOT_FOUND 에러를 던진다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue({
        opinion: null,
        reasons: null,
      });

      await expect(
        service.getMemberKeynote('community-uuid', 'member-uuid'),
      ).rejects.toMatchObject({
        appError: CommunityErrorCode.KEYNOTE_NOT_FOUND,
      });
    });

    it('작성된 기조발언을 KeynoteDto로 반환한다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue({
        opinion: '찬성',
        reasons: ['이유1'],
      });

      const result = await service.getMemberKeynote(
        'community-uuid',
        'member-uuid',
      );

      expect(result).toEqual({ opinion: '찬성', reasons: ['이유1'] });
    });
  });

  describe('joinMe (커뮤니티 참여)', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'host-uuid',
      });
    });

    it('참여 행을 넣고 같은 트랜잭션에서 참여자 수를 1 늘린다', async () => {
      await service.joinMe('community-uuid', 'member-uuid');

      expect(memberCommunitiesService.insertIfAbsent).toHaveBeenCalledWith(
        'member-uuid',
        'community-uuid',
        manager,
      );
      expect(manager.increment).toHaveBeenCalledWith(
        Community,
        { id: 'community-uuid' },
        'memberCount',
        1,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('이미 참여 중이면 참여자 수를 늘리지 않는다(멱등)', async () => {
      memberCommunitiesService.insertIfAbsent.mockResolvedValue(false);

      await expect(
        service.joinMe('community-uuid', 'member-uuid'),
      ).resolves.toBeUndefined();
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('커뮤니티가 없으면 NOT_FOUND를 던지고 아무것도 넣지 않는다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.joinMe('community-uuid', 'member-uuid'),
      ).rejects.toMatchObject({ appError: CommunityErrorCode.NOT_FOUND });
      expect(memberCommunitiesService.insertIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe('leaveMe (커뮤니티 나가기)', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'host-uuid',
      });
    });

    it('참여 행을 지우고 같은 트랜잭션에서 참여자 수를 1 줄인다', async () => {
      await service.leaveMe('community-uuid', 'member-uuid');

      expect(memberCommunitiesService.deleteOne).toHaveBeenCalledWith(
        'member-uuid',
        'community-uuid',
        manager,
      );
      expect(manager.decrement).toHaveBeenCalledWith(
        Community,
        { id: 'community-uuid' },
        'memberCount',
        1,
      );
    });

    it('참여 중이 아니었으면 참여자 수를 줄이지 않는다(멱등)', async () => {
      memberCommunitiesService.deleteOne.mockResolvedValue(false);

      await expect(
        service.leaveMe('community-uuid', 'member-uuid'),
      ).resolves.toBeUndefined();
      expect(manager.decrement).not.toHaveBeenCalled();
    });

    it('방장은 나갈 수 없다', async () => {
      await expect(
        service.leaveMe('community-uuid', 'host-uuid'),
      ).rejects.toMatchObject({
        appError: CommunityErrorCode.HOST_CANNOT_LEAVE,
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('커뮤니티가 없으면 NOT_FOUND를 던진다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.leaveMe('community-uuid', 'member-uuid'),
      ).rejects.toMatchObject({ appError: CommunityErrorCode.NOT_FOUND });
      expect(memberCommunitiesService.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe('addMyFavorite (즐겨찾기)', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({ id: 'community-uuid' });
    });

    // 신규/기존 여부와 무관하게 (memberId, communityId) 유니크로 isFavored=true upsert (원자적)
    it('유니크 충돌 경로로 isFavored=true를 upsert한다', async () => {
      await service.addMyFavorite('community-uuid', 'member-uuid');

      expect(communityFavoriteRepository.upsert).toHaveBeenCalledWith(
        {
          memberId: 'member-uuid',
          communityId: 'community-uuid',
          isFavored: true,
        },
        ['memberId', 'communityId'],
      );
    });

    it('커뮤니티가 없으면 NOT_FOUND 에러를 던지고 upsert하지 않는다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.addMyFavorite('community-uuid', 'member-uuid'),
      ).rejects.toMatchObject({ appError: CommunityErrorCode.NOT_FOUND });
      expect(communityFavoriteRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('deleteMyFavorite (즐겨찾기)', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({ id: 'community-uuid' });
    });

    // 단일 UPDATE로 isFavored=false (row가 없으면 affected=0 → no-op)
    it('isFavored=false로 단일 update한다', async () => {
      await service.deleteMyFavorite('community-uuid', 'member-uuid');

      expect(communityFavoriteRepository.update).toHaveBeenCalledWith(
        { memberId: 'member-uuid', communityId: 'community-uuid' },
        { isFavored: false },
      );
    });

    it('커뮤니티가 없으면 NOT_FOUND 에러를 던지고 update하지 않는다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.deleteMyFavorite('community-uuid', 'member-uuid'),
      ).rejects.toMatchObject({ appError: CommunityErrorCode.NOT_FOUND });
      expect(communityFavoriteRepository.update).not.toHaveBeenCalled();
    });
  });
});
