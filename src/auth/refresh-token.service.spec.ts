import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { createHash } from 'node:crypto';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthErrorCode } from './exceptions/auth-error-code';
import { RefreshTokenService } from './refresh-token.service';
import { IssuedToken } from './token.service';

const MEMBER_ID = 'member-uuid';
const HOUR = 60 * 60 * 1000;

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** expect.any의 반환 타입이 any라, 인자 위치에서 쓰려면 좁혀 준다 */
const anyDate = (): Date => expect.any(Date) as Date;

const issuedToken = (token: string, expiresInMs = HOUR): IssuedToken => ({
  token,
  jti: `${token}-jti`,
  expiresAt: new Date(Date.now() + expiresInMs),
});

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let repository: {
    save: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let entityManager: { save: jest.Mock };

  /** DB에서 막 읽어온 듯한 활성 RefreshToken */
  const storedToken = (
    token: string,
    overrides: Partial<RefreshToken> = {},
  ): RefreshToken =>
    Object.assign(
      RefreshToken.issue({
        memberId: MEMBER_ID,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + HOUR),
      }),
      { id: `${token}-id` },
      overrides,
    );

  beforeEach(async () => {
    entityManager = {
      save: jest.fn((entity: { id?: string }) => {
        entity.id ??= 'new-token-id';
        return Promise.resolve(entity);
      }),
    };

    repository = {
      save: jest.fn((entity: RefreshToken) => Promise.resolve(entity)),
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn(
          (runInTransaction: (manager: typeof entityManager) => unknown) =>
            runInTransaction(entityManager),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: getRepositoryToken(RefreshToken), useValue: repository },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  describe('persist', () => {
    it('토큰 원문 대신 sha256 해시를 저장한다', async () => {
      const issued = issuedToken('refresh-token-1');

      const saved = await service.persist(MEMBER_ID, issued);

      expect(saved.tokenHash).toBe(sha256(issued.token));
      expect(saved.tokenHash).not.toContain(issued.token);
      expect(saved.memberId).toBe(MEMBER_ID);
      expect(saved.expiresAt).toBe(issued.expiresAt);
      expect(saved.revokedAt).toBeNull();
    });
  });

  describe('rotate', () => {
    it('새 토큰을 저장하고 이전 토큰을 대체 이력과 함께 폐기한다', async () => {
      const current = storedToken('old-token');
      repository.findOneBy.mockResolvedValue(current);

      await service.rotate(MEMBER_ID, 'old-token', issuedToken('new-token'));

      // 해시로 조회한다(원문 조회 금지)
      expect(repository.findOneBy).toHaveBeenCalledWith({
        tokenHash: sha256('old-token'),
      });

      // 새 토큰 저장과 이전 토큰 폐기는 한 트랜잭션 안에서 일어난다
      expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
      expect(entityManager.save).toHaveBeenCalledTimes(2);

      const [issued] = entityManager.save.mock.calls[0] as [RefreshToken];
      expect(issued.tokenHash).toBe(sha256('new-token'));

      expect(current.revokedAt).not.toBeNull();
      expect(current.replacedById).toBe(issued.id);
    });

    it('등록되지 않은 토큰이면 INVALID_REFRESH_TOKEN 에러를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.rotate(MEMBER_ID, 'unknown-token', issuedToken('new-token')),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('다른 회원의 토큰이면 INVALID_REFRESH_TOKEN 에러를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(
        storedToken('someone-elses-token', { memberId: 'other-member-uuid' }),
      );

      await expect(
        service.rotate(
          MEMBER_ID,
          'someone-elses-token',
          issuedToken('new-token'),
        ),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('이미 회전된 토큰의 재제출은 탈취로 보고 회원의 모든 활성 토큰을 폐기한다', async () => {
      repository.findOneBy.mockResolvedValue(
        storedToken('reused-token', {
          revokedAt: new Date(Date.now() - HOUR),
          replacedById: 'successor-id',
        }),
      );

      await expect(
        service.rotate(MEMBER_ID, 'reused-token', issuedToken('new-token')),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });

      expect(repository.update).toHaveBeenCalledWith(
        { memberId: MEMBER_ID, revokedAt: IsNull() },
        { revokedAt: anyDate() },
      );
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('만료된 토큰은 거부하되 다른 세션까지 끊지는 않는다', async () => {
      repository.findOneBy.mockResolvedValue(
        storedToken('expired-token', {
          expiresAt: new Date(Date.now() - HOUR),
        }),
      );

      await expect(
        service.rotate(MEMBER_ID, 'expired-token', issuedToken('new-token')),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });

      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('해당 회원의 활성 토큰만 골라 폐기한다', async () => {
      await service.revoke(MEMBER_ID, 'refresh-token-1');

      expect(repository.update).toHaveBeenCalledWith(
        {
          memberId: MEMBER_ID,
          tokenHash: sha256('refresh-token-1'),
          revokedAt: IsNull(),
        },
        { revokedAt: anyDate() },
      );
    });

    it('이미 없거나 폐기된 토큰이어도 실패하지 않는다(멱등)', async () => {
      repository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.revoke(MEMBER_ID, 'already-gone'),
      ).resolves.toBeUndefined();
    });
  });

  describe('revokeAllForMember', () => {
    it('회원의 활성 토큰을 한 번에 폐기한다', async () => {
      await service.revokeAllForMember(MEMBER_ID);

      expect(repository.update).toHaveBeenCalledWith(
        { memberId: MEMBER_ID, revokedAt: IsNull() },
        { revokedAt: anyDate() },
      );
    });
  });

  describe('RefreshToken.revoke', () => {
    it('이미 폐기된 토큰의 최초 폐기 이력을 덮어쓰지 않는다', () => {
      const firstRevokedAt = new Date(Date.now() - HOUR);
      const token = storedToken('token', {
        revokedAt: firstRevokedAt,
        replacedById: 'successor-id',
      });

      token.revoke(new Date(), 'another-id');

      expect(token.revokedAt).toBe(firstRevokedAt);
      expect(token.replacedById).toBe('successor-id');
    });
  });
});
