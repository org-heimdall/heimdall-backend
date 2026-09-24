import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { CommunityMessagesService } from './community-messages.service';
import {
  CommunityChatMessageType,
  CommunityMessage,
} from './entities/community-message.entity';

describe('CommunityMessagesService', () => {
  let service: CommunityMessagesService;
  let insertQueryBuilder: {
    insert: jest.Mock;
    values: jest.Mock;
    orIgnore: jest.Mock;
    execute: jest.Mock;
  };
  let repository: {
    createQueryBuilder: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };

  const COMMUNITY_ID = 'community-uuid';

  const buildMessage = (
    overrides: Partial<Parameters<typeof CommunityMessage.write>[0]> = {},
  ) =>
    CommunityMessage.write({
      id: 'message-uuid',
      communityId: COMMUNITY_ID,
      memberId: 'member-uuid',
      clientMessageId: 'client-key',
      text: '안녕하세요',
      createdAt: new Date('2026-09-18T12:00:00.000Z'),
      ...overrides,
    });

  beforeEach(async () => {
    insertQueryBuilder = {
      insert: jest.fn(() => insertQueryBuilder),
      values: jest.fn(() => insertQueryBuilder),
      orIgnore: jest.fn(() => insertQueryBuilder),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 'message-uuid' }] }),
    };
    repository = {
      createQueryBuilder: jest.fn(() => insertQueryBuilder),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityMessagesService,
        {
          provide: getRepositoryToken(CommunityMessage),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get(CommunityMessagesService);
  });

  describe('create', () => {
    it('유니크 충돌을 무시하는 insert로 저장하고 STORED를 돌려준다', async () => {
      const message = buildMessage();

      const result = await service.create(message);

      expect(insertQueryBuilder.values).toHaveBeenCalledWith(message);
      // 재전송은 예외가 아니라 "아무것도 넣지 않음"으로 처리한다.
      expect(insertQueryBuilder.orIgnore).toHaveBeenCalled();
      expect(result).toEqual({ status: 'STORED', message });
      // 저장된 값을 그대로 쓰므로 재조회하지 않는다.
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('아무것도 넣지 않았으면 DUPLICATE로 기존 메시지를 재조회해 돌려준다', async () => {
      insertQueryBuilder.execute.mockResolvedValue({ raw: [] });
      const stored = buildMessage({ id: 'stored-uuid' });
      repository.findOne.mockResolvedValue(stored);

      const result = await service.create(buildMessage());

      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          communityId: COMMUNITY_ID,
          clientMessageId: 'client-key',
          status: ResourceStatus.NORMAL,
        },
        relations: { member: true },
      });
      expect(result).toEqual({ status: 'DUPLICATE', message: stored });
    });

    it('기존 메시지가 삭제돼 읽히지 않아도 DUPLICATE로 알린다', async () => {
      insertQueryBuilder.execute.mockResolvedValue({ raw: [] });
      repository.findOne.mockResolvedValue(null);
      const message = buildMessage();

      await expect(service.create(message)).resolves.toEqual({
        status: 'DUPLICATE',
        message,
      });
    });
    it('manager를 받으면 호출자 트랜잭션의 레포지토리로 저장한다', async () => {
      const txRepository = {
        createQueryBuilder: jest.fn(() => insertQueryBuilder),
        findOne: jest.fn(),
      };
      const manager = { getRepository: jest.fn(() => txRepository) };
      const message = buildMessage();

      const result = await service.create(message, manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(CommunityMessage);
      expect(txRepository.createQueryBuilder).toHaveBeenCalled();
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(result.status).toBe('STORED');
    });

    it('같은 결정적 키의 시스템 메시지를 다시 넣으면 DUPLICATE다', async () => {
      insertQueryBuilder.execute.mockResolvedValue({ raw: [] });
      const params = {
        communityId: COMMUNITY_ID,
        debateId: 'debate-uuid',
        messageType: CommunityChatMessageType.DEBATE_FORFEIT,
        clientMessageId: 'debate_forfeit:debate-uuid',
        text: '기권',
        createdAt: new Date('2026-09-18T12:00:00.000Z'),
      };
      const system = CommunityMessage.system({ ...params, id: 'system-uuid' });
      repository.findOne.mockResolvedValue(system);

      const result = await service.create(
        CommunityMessage.system({ ...params, id: 'retry-uuid' }),
      );

      expect(result).toEqual({ status: 'DUPLICATE', message: system });
      expect(system.memberId).toBeNull();
    });
  });

  describe('findByClientMessageId', () => {
    it('삭제되지 않은 메시지를 작성자와 함께 읽는다', async () => {
      const stored = buildMessage();
      repository.findOne.mockResolvedValue(stored);

      await expect(
        service.findByClientMessageId(COMMUNITY_ID, 'client-key'),
      ).resolves.toBe(stored);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          communityId: COMMUNITY_ID,
          clientMessageId: 'client-key',
          status: ResourceStatus.NORMAL,
        },
        relations: { member: true },
      });
    });
  });

  describe('findRecent', () => {
    it('삭제된 메시지를 빼고 최근 limit개를 오래된 순으로 돌려준다', async () => {
      const older = buildMessage({ id: 'older' });
      const newer = buildMessage({ id: 'newer' });
      // 저장소는 최신순으로 읽는다.
      repository.find.mockResolvedValue([newer, older]);

      const result = await service.findRecent(COMMUNITY_ID, 50);

      expect(repository.find).toHaveBeenCalledWith({
        where: { communityId: COMMUNITY_ID, status: ResourceStatus.NORMAL },
        relations: { member: true },
        order: { createdAt: 'DESC' },
        take: 50,
      });
      expect(result.map((message) => message.id)).toEqual(['older', 'newer']);
    });

    it('limit 기본값은 계약의 50이다', async () => {
      await service.findRecent(COMMUNITY_ID);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('before를 주면 그 시각 이전만 읽는다', async () => {
      const before = new Date('2026-09-18T12:00:00.000Z');

      await service.findRecent(COMMUNITY_ID, 20, before);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            communityId: COMMUNITY_ID,
            status: ResourceStatus.NORMAL,
            createdAt: LessThan(before),
          },
          take: 20,
        }),
      );
    });
  });
});
