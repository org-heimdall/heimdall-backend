import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MemberCommunitiesService } from './member-communities.service';
import { MemberCommunity } from './entities/member-community.entity';

describe('MemberCommunitiesService', () => {
  let service: MemberCommunitiesService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    upsert: jest.Mock;
    findBy: jest.Mock;
    findOneBy: jest.Mock;
    findOneByOrFail: jest.Mock;
    delete: jest.Mock;
  };

  const buildRow = (
    overrides: Partial<MemberCommunity> = {},
  ): MemberCommunity => ({
    id: 'mc-uuid',
    memberId: 'member-uuid',
    communityId: 'community-uuid',
    opinion: null,
    reasons: null,
    ...overrides,
  });

  beforeEach(async () => {
    repository = {
      create: jest.fn((entity: Partial<MemberCommunity>) => entity),
      save: jest.fn((entity: MemberCommunity) => Promise.resolve(entity)),
      upsert: jest.fn().mockResolvedValue({ identifiers: [] }),
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
    it('communityId로 참여자 행을 조회한다', async () => {
      const rows = [buildRow()];
      repository.findBy.mockResolvedValue(rows);

      const result = await service.findParticipants('community-uuid');

      expect(result).toBe(rows);
      expect(repository.findBy).toHaveBeenCalledWith({
        communityId: 'community-uuid',
      });
    });
  });

  describe('upsertKeynote', () => {
    // 신규/기존 여부와 무관하게 (memberId, communityId) 유니크로 opinion/reasons를 upsert (원자적)
    it('유니크 충돌 경로로 upsert하고 재조회 없이 제출한 값을 그대로 반환한다', async () => {
      const result = await service.upsertKeynote(
        'member-uuid',
        'community-uuid',
        '수정된 의견',
        ['새이유'],
      );

      expect(repository.upsert).toHaveBeenCalledWith(
        {
          memberId: 'member-uuid',
          communityId: 'community-uuid',
          opinion: '수정된 의견',
          reasons: ['새이유'],
        },
        ['memberId', 'communityId'],
      );
      // 재조회(findOneBy/findOneByOrFail)나 읽기-수정-쓰기(save) 경로를 타지 않는다
      expect(repository.findOneBy).not.toHaveBeenCalled();
      expect(repository.findOneByOrFail).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(result.opinion).toBe('수정된 의견');
      expect(result.reasons).toEqual(['새이유']);
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
});
