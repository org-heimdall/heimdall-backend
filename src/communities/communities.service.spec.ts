import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GeneralException } from '../common/exceptions/general.exception';
import { CommunitiesService } from './communities.service';
import { CommunityErrorCode } from './exceptions/community-error-code';
import { MemberErrorCode } from '../members/exceptions/member-error-code';
import { Community, CommunityState } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityTheme } from './entities/community-theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { MembersService } from '../members/members.service';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { CommunityErrorCode } from './exceptions/community-error-code';

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let communityRepository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let themeRepository: { find: jest.Mock };
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
    findOne: jest.Mock;
    upsertKeynote: jest.Mock;
  };
  let queryBuilder: {
    where: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    innerJoin: jest.Mock;
    getMany: jest.Mock;
    getCount: jest.Mock;
  };
  // 트랜잭션 콜백에 넘길 가짜 manager. 엔티티별 트랜잭션 레포지토리를 캐싱해 반환한다.
  let txRepos: Map<
    unknown,
    { create: jest.Mock; save: jest.Mock; delete: jest.Mock }
  >;
  let manager: { getRepository: jest.Mock };

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
      orderBy: jest.fn(() => queryBuilder),
      skip: jest.fn(() => queryBuilder),
      take: jest.fn(() => queryBuilder),
      innerJoin: jest.fn(() => queryBuilder),
      getMany: jest.fn(),
      getCount: jest.fn(),
    };
    communityRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOneBy: jest.fn(),
      save: jest.fn((e) => Promise.resolve(e)),
    };
    themeRepository = { find: jest.fn() };
    communityFavoriteRepository = {
      upsert: jest.fn().mockResolvedValue({ identifiers: [] }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    txRepos = new Map();
    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (!txRepos.has(entity)) {
          txRepos.set(entity, {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            create: jest.fn((e) => e),
            // TypeORM save처럼 저장된 엔티티에 생성 id를 채워 반환한다
            save: jest.fn((e) =>
              Promise.resolve({ ...e, id: 'new-community' }),
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
      findOne: jest.fn(),
      upsertKeynote: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        {
          provide: getRepositoryToken(Community),
          useValue: communityRepository,
        },
        { provide: getRepositoryToken(Theme), useValue: themeRepository },
        { provide: getRepositoryToken(CommunityTheme), useValue: {} },
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

  describe('findAll', () => {
    it('size+1개가 조회되면 hasNext=true, 목록은 size개로 자른다', async () => {
      const rows = [
        { id: 'c1', hostId: 'h1' },
        { id: 'c2', hostId: 'h1' },
        { id: 'c3', hostId: 'h1' },
      ];
      queryBuilder.getMany.mockResolvedValue(rows);
      queryBuilder.getCount.mockResolvedValue(10);
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'h1', profileImageUrl: 'url1' }),
      ]);

      const result = await service.findAll(1, 2, CommunitySort.MEMBER_ASC);

      expect(result.pageInfo).toEqual({ hasNext: true, page: 1, size: 2 });
      expect(result.communityPreviews).toHaveLength(2);
      expect(result.totalCommunityCount).toBe(10);
      expect(result.communityPreviews[0].hostProfileImageUrl).toBe('url1');
    });

    it('정렬 기준을 memberCount ASC 컬럼으로 매핑한다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      queryBuilder.getCount.mockResolvedValue(0);
      membersService.findByIds.mockResolvedValue([]);

      await service.findAll(1, 10, CommunitySort.MEMBER_ASC);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'community.memberCount',
        'ASC',
      );
    });

    it('themeId가 있으면 community_theme 조인 필터를 적용한다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      queryBuilder.getCount.mockResolvedValue(0);
      membersService.findByIds.mockResolvedValue([]);

      await service.findAll(1, 10, undefined, 'theme-uuid');

      expect(queryBuilder.innerJoin).toHaveBeenCalled();
    });

    it('themeId가 없으면 조인을 적용하지 않는다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      queryBuilder.getCount.mockResolvedValue(0);
      membersService.findByIds.mockResolvedValue([]);

      await service.findAll(1, 10);

      expect(queryBuilder.innerJoin).not.toHaveBeenCalled();
    });

    it('status=NORMAL 필터를 적용해 soft-delete된 커뮤니티를 제외한다', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      queryBuilder.getCount.mockResolvedValue(0);
      membersService.findByIds.mockResolvedValue([]);

      await service.findAll(1, 10);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'community.status = :status',
        { status: ResourceStatus.NORMAL },
      );
    });
  });

  describe('create', () => {
    const dto = {
      themeId: 'theme-uuid',
      topic: 'AI 규제',
      roundCount: 3,
      keynoteDto: { opinion: '찬성', reasons: ['이유1'] },
    };

    it('트랜잭션으로 community/community_theme/호스트 keynote를 생성한다', async () => {
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
          hostNickname: '호스트',
          memberCount: 1,
          topic: 'AI 규제',
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
      expect(result.communityId).toBe('new-community');
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

  describe('findCommunityMembers (memberType 분류)', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'host-uuid',
      });
      memberCommunitiesService.findParticipants.mockResolvedValue([
        { memberId: 'host-uuid', opinion: null },
        { memberId: 'keynote-uuid', opinion: '있음' },
        { memberId: 'normal-uuid', opinion: null },
      ]);
      membersService.findByIds.mockResolvedValue([
        buildMember({ id: 'host-uuid' }),
        buildMember({ id: 'keynote-uuid' }),
        buildMember({ id: 'normal-uuid' }),
      ]);
    });

    it('host/기조발언 여부로 memberType을 분류한다', async () => {
      const result = await service.findCommunityMembers('community-uuid');

      const byId = Object.fromEntries(
        result.map((r) => [r.memberId, r.memberType]),
      );
      expect(byId['host-uuid']).toBe(CommunityMemberType.HOST);
      expect(byId['keynote-uuid']).toBe(CommunityMemberType.KEYNOTE_MEMBER);
      expect(byId['normal-uuid']).toBe(CommunityMemberType.NORMAL_MEMBER);
    });

    it('memberType 필터를 적용한다', async () => {
      const result = await service.findCommunityMembers(
        'community-uuid',
        CommunityMemberType.KEYNOTE_MEMBER,
      );

      expect(result).toHaveLength(1);
      expect(result[0].memberId).toBe('keynote-uuid');
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
