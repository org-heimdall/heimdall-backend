import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { Community, CommunityState } from './entities/community.entity';
import { Theme } from './entities/theme.entity';
import { CommunityTheme } from './entities/community-theme.entity';
import { CommunityFavorite } from './entities/community-favorite.entity';
import { CommunityMemberType, CommunitySort } from './communities.enums';
import { MembersService } from '../members/members.service';
import { MemberCommunitiesService } from '../member-communities/member-communities.service';
import { Member } from '../members/entities/member.entity';

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let communityRepository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
  };
  let themeRepository: { find: jest.Mock };
  let communityFavoriteRepository: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
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

  const buildMember = (overrides: Partial<Member> = {}): Member => ({
    id: 'member-uuid',
    email: 'a@b.com',
    password: 'hash',
    nickname: '헤임달',
    gender: null,
    age: null,
    profileImageUrl: null,
    socialCredit: 0,
    rating: 0,
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
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
    };
    themeRepository = { find: jest.fn() };
    communityFavoriteRepository = {
      findOneBy: jest.fn(),
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    txRepos = new Map();
    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (!txRepos.has(entity)) {
          txRepos.set(entity, {
            create: jest.fn((e) => e),
            save: jest.fn((e) =>
              Promise.resolve({ id: 'new-community', ...e }),
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
      expect(communityTxRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          state: CommunityState.WAITING,
          hostId: 'host-uuid',
          hostNickname: '호스트',
          memberCount: 1,
          topic: 'AI 규제',
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

    it('호스트 회원이 없으면 NotFoundException을 던진다', async () => {
      membersService.findOneOrThrow.mockRejectedValue(
        new NotFoundException('회원을 찾을 수 없습니다.'),
      );

      await expect(service.create(dto, 'host-uuid')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('host가 아니면 ForbiddenException을 던진다', async () => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'other-uuid',
      });

      await expect(
        service.delete('community-uuid', 'not-host'),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('존재하지 않으면 NotFoundException을 던진다', async () => {
      communityRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.delete('community-uuid', 'host-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('host면 소유 리소스와 참여 행을 트랜잭션으로 삭제한다', async () => {
      communityRepository.findOneBy.mockResolvedValue({
        id: 'community-uuid',
        hostId: 'host-uuid',
      });

      await service.delete('community-uuid', 'host-uuid');

      expect(memberCommunitiesService.deleteByCommunity).toHaveBeenCalledWith(
        'community-uuid',
        manager,
      );
      expect(txRepos.get(Community)!.delete).toHaveBeenCalledWith({
        id: 'community-uuid',
      });
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
    it('행이 없으면 NotFoundException을 던진다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue(null);

      await expect(
        service.getMemberKeynote('community-uuid', 'member-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('기조발언 미작성(opinion=null)이면 NotFoundException을 던진다', async () => {
      memberCommunitiesService.findOne.mockResolvedValue({
        opinion: null,
        reasons: null,
      });

      await expect(
        service.getMemberKeynote('community-uuid', 'member-uuid'),
      ).rejects.toThrow(NotFoundException);
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

  describe('addMyFavorite (즐겨찾기 토글)', () => {
    beforeEach(() => {
      communityRepository.findOneBy.mockResolvedValue({ id: 'community-uuid' });
    });

    it('기존 row가 없으면 isFavored=true로 생성한다', async () => {
      communityFavoriteRepository.findOneBy.mockResolvedValue(null);

      await service.addMyFavorite('community-uuid', 'member-uuid');

      expect(communityFavoriteRepository.create).toHaveBeenCalledWith({
        memberId: 'member-uuid',
        communityId: 'community-uuid',
        isFavored: true,
      });
      expect(communityFavoriteRepository.save).toHaveBeenCalled();
    });

    it('기존 row가 false면 true로 토글한다', async () => {
      const existing = { isFavored: false };
      communityFavoriteRepository.findOneBy.mockResolvedValue(existing);

      await service.addMyFavorite('community-uuid', 'member-uuid');

      expect(existing.isFavored).toBe(true);
      expect(communityFavoriteRepository.save).toHaveBeenCalledWith(existing);
    });

    it('기존 row가 이미 true면 저장하지 않는다', async () => {
      communityFavoriteRepository.findOneBy.mockResolvedValue({
        isFavored: true,
      });

      await service.addMyFavorite('community-uuid', 'member-uuid');

      expect(communityFavoriteRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('deleteMyFavorite (즐겨찾기 토글)', () => {
    it('기존 row가 true면 false로 토글한다', async () => {
      const existing = { isFavored: true };
      communityFavoriteRepository.findOneBy.mockResolvedValue(existing);

      await service.deleteMyFavorite('community-uuid', 'member-uuid');

      expect(existing.isFavored).toBe(false);
      expect(communityFavoriteRepository.save).toHaveBeenCalledWith(existing);
    });

    it('기존 row가 없으면 no-op', async () => {
      communityFavoriteRepository.findOneBy.mockResolvedValue(null);

      await service.deleteMyFavorite('community-uuid', 'member-uuid');

      expect(communityFavoriteRepository.save).not.toHaveBeenCalled();
    });
  });
});
