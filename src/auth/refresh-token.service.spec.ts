import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator, IsNull } from 'typeorm';
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
const anyExpression = (): (() => string) =>
  expect.any(Function) as () => string;

/** update()의 SET 인자에 들어간 revokedAt 표현식을 SQL로 펼친다 */
const revokedAtSql = (set: unknown): string =>
  (set as { revokedAt: () => string }).revokedAt();

/** repository.update(where, set) 호출의 SET 인자 */
const setArgOf = (call: unknown): unknown => (call as unknown[])[1];

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
  let entityManager: { update: jest.Mock; insert: jest.Mock };

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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
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
    it('이전 토큰을 대체 이력과 함께 폐기하고 새 토큰을 저장한다', async () => {
      const current = storedToken('old-token');
      repository.findOneBy.mockResolvedValue(current);

      await service.rotate(MEMBER_ID, 'old-token', issuedToken('new-token'));

      // 해시로 조회한다(원문 조회 금지)
      expect(repository.findOneBy).toHaveBeenCalledWith({
        tokenHash: sha256('old-token'),
      });

      // 폐기와 새 토큰 저장은 한 트랜잭션 안에서 일어난다
      expect(repository.manager.transaction).toHaveBeenCalledTimes(1);

      const [, where, values] = entityManager.update.mock.calls[0] as [
        unknown,
        { id: string; revokedAt: unknown; expiresAt: FindOperator<Date> },
        { replacedById: string },
      ];
      // 폐기는 미폐기·미만료를 조건으로 건다(경합 시 한쪽만 성공)
      expect(where).toMatchObject({ id: current.id, revokedAt: IsNull() });
      // 만료 판정도 폐기 시각도 앱이 아니라 DB 시계(NOW()) 기준이다
      expect(where.expiresAt.getSql?.('"expires_at"')).toBe(
        '"expires_at" > NOW()',
      );
      expect(revokedAtSql(values)).toBe('NOW()');

      const [[, issued]] = entityManager.insert.mock.calls as [
        [unknown, RefreshToken],
      ];
      expect(issued.tokenHash).toBe(sha256('new-token'));
      expect(issued.revokedAt).toBeNull();
      // 대체 이력은 폐기 UPDATE가 새 토큰 id를 그대로 가리킨다
      expect(values.replacedById).toBe(issued.id);
    });

    it('폐기가 0행이면 새 토큰을 발급하지 않는다', async () => {
      repository.findOneBy.mockResolvedValue(storedToken('old-token'));
      entityManager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.rotate(MEMBER_ID, 'old-token', issuedToken('new-token')),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });

      expect(entityManager.insert).not.toHaveBeenCalled();
    });

    it('폐기가 0행이고 그 사이 폐기된 토큰이면(동시 회전) 회원의 모든 활성 토큰을 폐기한다', async () => {
      // 검증 시점엔 활성, 폐기 실패 후 재조회 시점엔 경합 상대가 이미 회전시킨 상태
      repository.findOneBy
        .mockResolvedValueOnce(storedToken('old-token'))
        .mockResolvedValueOnce(
          storedToken('old-token', {
            revokedAt: new Date(),
            replacedById: 'rival-token-id',
          }),
        );
      entityManager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.rotate(MEMBER_ID, 'old-token', issuedToken('new-token')),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });

      expect(repository.update).toHaveBeenCalledWith(
        { memberId: MEMBER_ID, revokedAt: IsNull() },
        { revokedAt: anyExpression() },
      );
    });

    it('폐기가 0행이고 그 사이 만료된 토큰이면 다른 세션까지 끊지는 않는다', async () => {
      // DB 시계로는 만료됐지만 앱이 읽은 시점엔 아직 유효했던 경우
      repository.findOneBy
        .mockResolvedValueOnce(storedToken('old-token'))
        .mockResolvedValueOnce(
          storedToken('old-token', { expiresAt: new Date(Date.now() - HOUR) }),
        );
      entityManager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.rotate(MEMBER_ID, 'old-token', issuedToken('new-token')),
      ).rejects.toMatchObject({
        appError: AuthErrorCode.INVALID_REFRESH_TOKEN,
      });

      expect(repository.update).not.toHaveBeenCalled();
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
        { revokedAt: anyExpression() },
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
        { revokedAt: anyExpression() },
      );
      // 폐기 시각은 DB 시계로 남긴다
      expect(revokedAtSql(setArgOf(repository.update.mock.calls[0]))).toBe(
        'NOW()',
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
        { revokedAt: anyExpression() },
      );
      // 폐기 시각은 DB 시계로 남긴다
      expect(revokedAtSql(setArgOf(repository.update.mock.calls[0]))).toBe(
        'NOW()',
      );
    });
  });
});
