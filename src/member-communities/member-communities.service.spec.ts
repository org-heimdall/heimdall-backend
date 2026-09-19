import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull, Not } from 'typeorm';
import { MemberCommunitiesService } from './member-communities.service';
import {
  CommunityDebateIntent,
  MemberCommunity,
} from './entities/member-community.entity';

describe('MemberCommunitiesService', () => {
  let service: MemberCommunitiesService;
  let insertQueryBuilder: {
    insert: jest.Mock;
    values: jest.Mock;
    orIgnore: jest.Mock;
    execute: jest.Mock;
  };
  let repository: {
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    upsert: jest.Mock;
    find: jest.Mock;
    findBy: jest.Mock;
    findOneBy: jest.Mock;
    findOneByOrFail: jest.Mock;
    delete: jest.Mock;
  };

  const buildRow = (
    overrides: Partial<MemberCommunity> = {},
  ): MemberCommunity =>
    Object.assign(new MemberCommunity(), {
      id: 'mc-uuid',
      memberId: 'member-uuid',
      communityId: 'community-uuid',
      opinion: null,
      reasons: null,
      ...overrides,
    });

  beforeEach(async () => {
    insertQueryBuilder = {
      insert: jest.fn(() => insertQueryBuilder),
      values: jest.fn(() => insertQueryBuilder),
      orIgnore: jest.fn(() => insertQueryBuilder),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 'mc-uuid' }] }),
    };
    repository = {
      createQueryBuilder: jest.fn(() => insertQueryBuilder),
      create: jest.fn((entity: Partial<MemberCommunity>) => entity),
      save: jest.fn((entity: MemberCommunity) => Promise.resolve(entity)),
      upsert: jest.fn().mockResolvedValue({ identifiers: [] }),
      find: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      findOneByOrFail: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberCommunitiesService,
        {
          provide: getRepositoryToken(MemberCommunity),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<MemberCommunitiesService>(MemberCommunitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findParticipants', () => {
    it('communityId로 참여자 행을 참여 순으로 조회한다', async () => {
      const rows = [buildRow()];
      repository.find.mockResolvedValue(rows);

      const result = await service.findParticipants('community-uuid');

      expect(result).toBe(rows);
      expect(repository.find).toHaveBeenCalledWith({
        where: { communityId: In(['community-uuid']) },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findParticipantsByCommunities', () => {
    it('여러 커뮤니티의 참여 행을 한 번에 조회한다', async () => {
      const rows = [buildRow()];
      repository.find.mockResolvedValue(rows);

      const result = await service.findParticipantsByCommunities(['c1', 'c2']);

      expect(result).toBe(rows);
      expect(repository.find).toHaveBeenCalledWith({
        where: { communityId: In(['c1', 'c2']) },
        order: { createdAt: 'ASC' },
      });
    });

    it('빈 목록이면 레포지토리를 조회하지 않는다', async () => {
      await expect(service.findParticipantsByCommunities([])).resolves.toEqual(
        [],
      );

      expect(repository.find).not.toHaveBeenCalled();
    });
  });

  describe('updateKeynote', () => {
    it('참여 행이 없으면 null을 돌려준다(호출자가 권한 에러로 옮긴다)', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateKeynote('member-uuid', 'community-uuid', '의견', []),
      ).resolves.toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('의견이 없던 행이면 created=true로 저장한다', async () => {
      repository.findOneBy.mockResolvedValue(buildRow({ opinion: null }));

      const result = await service.updateKeynote(
        'member-uuid',
        'community-uuid',
        '첫 의견',
        ['이유'],
      );

      expect(result).toMatchObject({ created: true });
      expect(result?.row.opinion).toBe('첫 의견');
      expect(result?.row.reasons).toEqual(['이유']);
      expect(repository.save).toHaveBeenCalledWith(result?.row);
    });

    it('이미 의견이 있던 행이면 created=false로 갱신한다', async () => {
      repository.findOneBy.mockResolvedValue(
        buildRow({ opinion: '기존 의견', reasons: ['기존 이유'] }),
      );

      const result = await service.updateKeynote(
        'member-uuid',
        'community-uuid',
        '수정된 의견',
        ['새 이유'],
      );

      expect(result).toMatchObject({ created: false });
      expect(result?.row.opinion).toBe('수정된 의견');
      // updatedAt 갱신을 위해 upsert가 아니라 save(UPDATE) 경로를 탄다.
      expect(repository.upsert).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('findOpinions', () => {
    it('기조 발언을 작성한 행만 조회한다', async () => {
      const rows = [buildRow({ opinion: '의견' })];
      repository.findBy.mockResolvedValue(rows);

      await expect(service.findOpinions('community-uuid')).resolves.toBe(rows);

      // TypeORM 1.0의 where는 null을 그대로 받으면 throw하므로 IsNull()/Not()을 쓴다.
      expect(repository.findBy).toHaveBeenCalledWith({
        communityId: 'community-uuid',
        opinion: Not(IsNull()),
      });
    });
  });

  describe('deleteByCommunity', () => {
    it('communityId에 속한 모든 행을 삭제한다', async () => {
      repository.delete.mockResolvedValue({ affected: 2 });

      await service.deleteByCommunity('community-uuid');

      expect(repository.delete).toHaveBeenCalledWith({
        communityId: 'community-uuid',
      });
    });

    it('manager가 주어지면 그 트랜잭션의 레포지토리를 사용한다', async () => {
      const txRepo = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
      const manager = { getRepository: jest.fn().mockReturnValue(txRepo) };

      await service.deleteByCommunity('community-uuid', manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(MemberCommunity);
      expect(txRepo.delete).toHaveBeenCalledWith({
        communityId: 'community-uuid',
      });
      // 트랜잭션 레포지토리를 썼으므로 기본 레포지토리는 건드리지 않는다
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
  describe('insertIfAbsent', () => {
    it('참여 행을 넣었으면 true를 돌려준다', async () => {
      await expect(
        service.insertIfAbsent('member-uuid', 'community-uuid'),
      ).resolves.toBe(true);

      expect(insertQueryBuilder.values).toHaveBeenCalledWith({
        memberId: 'member-uuid',
        communityId: 'community-uuid',
      });
      // 유니크 충돌은 예외가 아니라 "아무것도 넣지 않음"으로 처리한다.
      expect(insertQueryBuilder.orIgnore).toHaveBeenCalled();
    });

    it('이미 있어 아무것도 넣지 않았으면 false를 돌려준다', async () => {
      insertQueryBuilder.execute.mockResolvedValue({ raw: [] });

      await expect(
        service.insertIfAbsent('member-uuid', 'community-uuid'),
      ).resolves.toBe(false);
    });
  });

  describe('deleteOne', () => {
    it('지운 행이 있으면 true를 돌려준다', async () => {
      repository.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.deleteOne('member-uuid', 'community-uuid'),
      ).resolves.toBe(true);
      expect(repository.delete).toHaveBeenCalledWith({
        memberId: 'member-uuid',
        communityId: 'community-uuid',
      });
    });

    it('참여 중이 아니어서 지운 행이 없으면 false를 돌려준다', async () => {
      repository.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.deleteOne('member-uuid', 'community-uuid'),
      ).resolves.toBe(false);
    });
  });
  describe('updateDebateIntent', () => {
    it('참여 행이 없으면 null을 돌려준다(호출자가 도메인 에러로 옮긴다)', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateDebateIntent(
          'member-uuid',
          'community-uuid',
          CommunityDebateIntent.OPEN_TO_DEBATE,
        ),
      ).resolves.toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('참여 행의 토론 의사를 바꿔 저장한다(updatedAt 갱신을 위해 save 경로)', async () => {
      repository.findOneBy.mockResolvedValue(
        buildRow({ debateIntent: CommunityDebateIntent.PREPARING }),
      );

      const result = await service.updateDebateIntent(
        'member-uuid',
        'community-uuid',
        CommunityDebateIntent.OPEN_TO_DEBATE,
      );

      expect(result?.debateIntent).toBe(CommunityDebateIntent.OPEN_TO_DEBATE);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'member-uuid',
          debateIntent: CommunityDebateIntent.OPEN_TO_DEBATE,
        }),
      );
    });
  });
});
