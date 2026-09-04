import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityTarget } from 'typeorm';
import { SeedService } from './seed.service';
import { DebateSeed, DebateSeedSource } from './debate-seed.source';
import { Member } from '../members/entities/member.entity';
import { Theme } from '../communities/entities/theme.entity';
import { Community } from '../communities/entities/community.entity';
import { Debate } from '../debates/entities/debate.entity';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { ResourceStatus } from '../common/entities/resource-status.enum';

describe('SeedService', () => {
  let service: SeedService;
  let debateSeedSource: { load: jest.Mock };
  let communityRepository: { exists: jest.Mock; findOneBy: jest.Mock };
  let debateRepository: {
    exists: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let messageRepository: { insert: jest.Mock };

  const TOPIC = '기본소득 도입에 찬성하는가';
  const COMMUNITY_ID = 'community-uuid';
  const DEBATE_ID = 'debate-uuid';

  /** 자연키만 담은 대화 시드 한 건 */
  const buildSeed = (overrides: Partial<DebateSeed> = {}): DebateSeed => ({
    communityTopic: TOPIC,
    hostEmail: 'user1@example.com',
    opponentEmail: 'user2@example.com',
    messages: [
      { email: 'user1@example.com', turn: 1, body: '찬성합니다' },
      { email: 'user2@example.com', turn: 2, body: '반대합니다' },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    // 시드 계정·테마는 "이미 있는" 상태로 두어(멱등 경로) 대화 시딩만 검증 대상으로 남긴다.
    const memberRepository = {
      findOneBy: jest.fn(({ email }: { email: string }) =>
        Promise.resolve(
          Object.assign(new Member(), {
            id: `${email}-id`,
            email,
            nickname: email,
          }),
        ),
      ),
      save: jest.fn(),
      create: jest.fn(),
    };
    const themeRepository = {
      findOneBy: jest.fn(({ name }: { name: string }) =>
        Promise.resolve({ id: `${name}-id`, name }),
      ),
      save: jest.fn(),
      create: jest.fn(),
    };
    communityRepository = {
      // 커뮤니티도 이미 존재 → seedCommunities는 전부 건너뛴다.
      exists: jest.fn().mockResolvedValue(true),
      findOneBy: jest.fn(({ topic }: { topic: string }) =>
        Promise.resolve(topic === TOPIC ? { id: COMMUNITY_ID, topic } : null),
      ),
    };
    debateRepository = {
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((entity: object) => entity),
      save: jest.fn((entity: object) =>
        Promise.resolve({ ...entity, id: DEBATE_ID }),
      ),
    };
    messageRepository = { insert: jest.fn().mockResolvedValue(undefined) };

    const repositories = new Map<unknown, unknown>([
      [Member, memberRepository],
      [Theme, themeRepository],
      [Community, communityRepository],
      [Debate, debateRepository],
      [DebateMessage, messageRepository],
    ]);
    const manager: { getRepository: jest.Mock } = {
      getRepository: jest.fn(
        (entity: EntityTarget<unknown>) =>
          repositories.get(entity) ?? { save: jest.fn(), create: jest.fn() },
      ),
    };

    debateSeedSource = { load: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedService,
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(
              (runInTransaction: (entityManager: typeof manager) => unknown) =>
                runInTransaction(manager),
            ),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: DebateSeedSource, useValue: debateSeedSource },
      ],
    }).compile();

    service = module.get(SeedService);
  });

  it('대화 시드가 없으면 토론을 만들지 않는다', async () => {
    await service.seed();

    expect(debateRepository.save).not.toHaveBeenCalled();
    expect(messageRepository.insert).not.toHaveBeenCalled();
  });

  it('자연키를 FK로 해석해 토론과 대화를 넣는다', async () => {
    debateSeedSource.load.mockResolvedValue([buildSeed()]);

    await service.seed();

    expect(debateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: COMMUNITY_ID,
        hostId: 'user1@example.com-id',
        hostNickname: 'user1@example.com',
        opponentId: 'user2@example.com-id',
      }),
    );
    expect(messageRepository.insert).toHaveBeenCalledWith([
      {
        memberId: 'user1@example.com-id',
        debateId: DEBATE_ID,
        body: '찬성합니다',
        debate_turn: 1,
      },
      {
        memberId: 'user2@example.com-id',
        debateId: DEBATE_ID,
        body: '반대합니다',
        debate_turn: 2,
      },
    ]);
  });

  it('커뮤니티는 soft-delete되지 않은 행만 찾는다', async () => {
    debateSeedSource.load.mockResolvedValue([buildSeed()]);

    await service.seed();

    expect(communityRepository.findOneBy).toHaveBeenCalledWith({
      topic: TOPIC,
      status: ResourceStatus.NORMAL,
    });
  });

  it('이미 토론이 있으면 다시 넣지 않는다', async () => {
    debateSeedSource.load.mockResolvedValue([buildSeed()]);
    debateRepository.exists.mockResolvedValue(true);

    await service.seed();

    expect(debateRepository.save).not.toHaveBeenCalled();
    expect(messageRepository.insert).not.toHaveBeenCalled();
  });

  it('커뮤니티를 찾지 못하면 해당 시드를 건너뛴다', async () => {
    debateSeedSource.load.mockResolvedValue([
      buildSeed({ communityTopic: '존재하지 않는 주제' }),
    ]);

    await service.seed();

    expect(debateRepository.save).not.toHaveBeenCalled();
  });

  it('시드 계정에 없는 이메일을 참조하면 에러를 던진다', async () => {
    debateSeedSource.load.mockResolvedValue([
      buildSeed({ hostEmail: 'unknown@example.com' }),
    ]);

    await expect(service.seed()).rejects.toThrow(
      '대화 시드가 참조한 시드 계정이 없습니다: unknown@example.com',
    );
  });

  it('메시지가 많으면 나눠서 insert 한다', async () => {
    const messages = Array.from({ length: 1200 }, (_, index) => ({
      email: 'user1@example.com',
      turn: index + 1,
      body: `발언 ${index + 1}`,
    }));
    debateSeedSource.load.mockResolvedValue([buildSeed({ messages })]);

    await service.seed();

    const chunkSizes = messageRepository.insert.mock.calls.map(
      ([rows]: [unknown[]]) => rows.length,
    );
    expect(chunkSizes).toEqual([500, 500, 200]);
  });
});
