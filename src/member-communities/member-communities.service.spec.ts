import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MemberCommunitiesService } from './member-communities.service';
import { MemberCommunity } from './entities/member-community.entity';

describe('MemberCommunitiesService', () => {
  let service: MemberCommunitiesService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findBy: jest.Mock;
    findOneBy: jest.Mock;
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
      findBy: jest.fn(),
      findOneBy: jest.fn(),
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
    it('기존 행이 없으면 참여+기조발언 행을 새로 생성한다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      const result = await service.upsertKeynote(
        'member-uuid',
        'community-uuid',
        '찬성',
        ['이유1'],
      );

      expect(repository.create).toHaveBeenCalledWith({
        memberId: 'member-uuid',
        communityId: 'community-uuid',
        opinion: '찬성',
        reasons: ['이유1'],
      });
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(result.opinion).toBe('찬성');
    });

    it('기존 행이 있으면 opinion/reasons만 갱신한다', async () => {
      const existing = buildRow({ opinion: '이전', reasons: ['이전이유'] });
      repository.findOneBy.mockResolvedValue(existing);

      const result = await service.upsertKeynote(
        'member-uuid',
        'community-uuid',
        '수정된 의견',
        ['새이유'],
      );

      // 새 행을 만들지 않고 기존 행을 저장한다
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(existing);
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
