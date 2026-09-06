import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { Community } from '../communities/entities/community.entity';
import { DebatesService } from './debates.service';
import { Debate, DebateTurn } from './entities/debate.entity';
import { DebateErrorCode } from './exceptions/debate-error-code';

describe('DebatesService', () => {
  let service: DebatesService;
  let debateRepository: { findOne: jest.Mock };

  const DEBATE_ID = 'debate-uuid';

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: 'community-uuid',
      hostId: 'host-uuid',
      hostNickname: '메시',
      opponentId: 'opponent-uuid',
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      winnerId: null,
      solution: null,
      status: ResourceStatus.NORMAL,
      community: Object.assign(new Community(), {
        id: 'community-uuid',
        debateRoundCount: 3,
        status: ResourceStatus.NORMAL,
      }),
      ...overrides,
    });

  beforeEach(async () => {
    debateRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebatesService,
        { provide: getRepositoryToken(Debate), useValue: debateRepository },
      ],
    }).compile();

    service = module.get<DebatesService>(DebatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
      const [{ where }] = debateRepository.findOne.mock.calls[0] as [
        {
          where: {
            status: ResourceStatus;
            community: { status: ResourceStatus };
          };
        },
      ];
      expect(where.status).toBe(ResourceStatus.NORMAL);
      expect(where.community.status).toBe(ResourceStatus.NORMAL);
    });
  });
});
