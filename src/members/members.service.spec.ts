import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { MembersService } from './members.service';
import { UpdateMemberDto } from './dto/update-member.dto';
import {
  INITIAL_SOCIAL_CREDIT,
  MEMBER_EMAIL_UNIQUE,
  Member,
} from './entities/member.entity';
import { MemberOAuthAccount } from './entities/member-oauth-account.entity';
import { MemberErrorCode } from './exceptions/member-error-code';
import { OAuthProviderType } from './members.enums';
import { AuthSessionService } from '../auth/auth-session.service';
import { AuthTokenDto } from '../auth/dto/auth-token.dto';
import { ResourceStatus } from '../common/entities/resource-status.enum';

describe('MembersService', () => {
  let service: MembersService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    findBy: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let oauthAccountRepository: { findOneBy: jest.Mock; save: jest.Mock };
  let entityManager: { save: jest.Mock };
  let authSessionService: { start: jest.Mock };

  /** login이 반환할 세션 토큰 스텁 */
  const authToken = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 1800,
  } as AuthTokenDto;

  const signUpDto = {
    email: 'heimdall@example.com',
    password: 'password1234',
    nickname: '헤임달',
  };

  /** pg 드라이버가 던지는 에러 모양(code=SQLSTATE, unique 위반이면 constraint=제약 이름) */
  const pgDriverError = (code: string, constraint?: string): Error =>
    Object.assign(new Error(`pg error ${code}`), { code, constraint });

  /** signUpDto.password를 해싱해 가진, DB에서 막 읽어온 듯한 Member */
  const buildMember = async (): Promise<Member> =>
    Object.assign(new Member(), {
      id: 'member-uuid',
      email: signUpDto.email,
      password: await bcrypt.hash(signUpDto.password, 10),
      nickname: signUpDto.nickname,
      gender: null, // 바꾸지 않은 (전달되지 않은) 값들은 수정하지 않음을 테스트
      age: null,
      profileImageUrl: null,
      socialCredit: 0,
      rating: 0,
      status: ResourceStatus.NORMAL,
    });

  beforeEach(async () => {
    // 트랜잭션 콜백에 넘어가는 EntityManager. save 시 id가 없으면 채워 준다(DB 생성값 흉내).
    entityManager = {
      save: jest.fn((entity: { id?: string }) => {
        entity.id ??= 'generated-uuid';
        return Promise.resolve(entity);
      }),
    };

    repository = {
      create: jest.fn((entity: Member) => entity),
      save: jest.fn(),
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      manager: {
        transaction: jest.fn(
          (runInTransaction: (manager: typeof entityManager) => unknown) =>
            runInTransaction(entityManager),
        ),
      },
    };

    oauthAccountRepository = { findOneBy: jest.fn(), save: jest.fn() };
    authSessionService = { start: jest.fn().mockResolvedValue(authToken) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: getRepositoryToken(Member), useValue: repository },
        {
          provide: getRepositoryToken(MemberOAuthAccount),
          useValue: oauthAccountRepository,
        },
        { provide: AuthSessionService, useValue: authSessionService },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('signUp', () => {
    it('비밀번호를 해싱해 저장하고, 응답에는 password를 포함하지 않는다', async () => {
      let savedMember: Member | undefined;
      repository.save.mockImplementation((member: Member) => {
        savedMember = member;
        return Promise.resolve({
          ...member,
          id: 'member-uuid',
          socialCredit: 0,
          rating: 0,
        });
      });

      const result = await service.signUp(signUpDto);

      expect(savedMember?.password).not.toBe(signUpDto.password);
      await expect(
        bcrypt.compare(signUpDto.password, savedMember!.password!),
      ).resolves.toBe(true);

      // 저장 전 in-memory 엔티티도 NORMAL이어야 isDeleted()가 오판하지 않는다
      expect(savedMember?.status).toBe(ResourceStatus.NORMAL);
      expect(savedMember?.isDeleted()).toBe(false);

      expect(result).toEqual({
        memberId: 'member-uuid',
        email: signUpDto.email,
        nickname: signUpDto.nickname,
        gender: null,
        age: null,
        profileImageUrl: null,
        socialCredit: 0,
        rating: 0,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('이메일 unique 제약을 위반하면 EMAIL_ALREADY_EXISTS 에러를 던진다', async () => {
      repository.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          pgDriverError('23505', MEMBER_EMAIL_UNIQUE),
        ),
      );

      await expect(service.signUp(signUpDto)).rejects.toMatchObject({
        appError: MemberErrorCode.EMAIL_ALREADY_EXISTS,
      });
    });

    // 두 번째 unique 제약이 생겼을 때 이메일 중복으로 오분류하지 않는지 확인하는 회귀 테스트
    it('매핑되지 않은 unique 제약 위반은 그대로 전파한다', async () => {
      const error = new QueryFailedError(
        'INSERT',
        [],
        pgDriverError('23505', 'UQ_member_nickname'),
      );
      repository.save.mockRejectedValue(error);

      await expect(service.signUp(signUpDto)).rejects.toBe(error);
    });

    it('제약 이름이 없는 unique 위반은 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('23505'));
      repository.save.mockRejectedValue(error);

      await expect(service.signUp(signUpDto)).rejects.toBe(error);
    });

    it('unique 위반이 아닌 DB 에러는 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('08006'));
      repository.save.mockRejectedValue(error);

      await expect(service.signUp(signUpDto)).rejects.toBe(error);
    });
  });

  describe('login', () => {
    it('이메일과 비밀번호가 일치하면 해당 회원의 세션(토큰)을 발급한다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      const result = await service.login({
        email: signUpDto.email,
        password: signUpDto.password,
      });

      expect(authSessionService.start).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'member-uuid' }),
      );
      expect(result).toBe(authToken);
      expect(result).not.toHaveProperty('password');
    });

    it('비밀번호가 없는 소셜 전용 계정은 INVALID_CREDENTIALS로 거부하고 세션을 만들지 않는다', async () => {
      const socialOnly = await buildMember();
      socialOnly.password = null;
      repository.findOneBy.mockResolvedValue(socialOnly);

      await expect(
        service.login({ email: signUpDto.email, password: signUpDto.password }),
      ).rejects.toMatchObject({
        appError: MemberErrorCode.INVALID_CREDENTIALS,
      });
      expect(authSessionService.start).not.toHaveBeenCalled();
    });

    it('존재하지 않는 이메일이면 INVALID_CREDENTIALS 에러를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever12' }),
      ).rejects.toMatchObject({
        appError: MemberErrorCode.INVALID_CREDENTIALS,
      });
    });

    it('비밀번호가 틀리면 INVALID_CREDENTIALS 에러를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      await expect(
        service.login({ email: signUpDto.email, password: 'wrongpassword' }),
      ).rejects.toMatchObject({
        appError: MemberErrorCode.INVALID_CREDENTIALS,
      });
    });

    it('status=NORMAL 조건으로만 조회해 soft-delete된 회원을 제외한다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.login({ email: signUpDto.email, password: signUpDto.password }),
      ).rejects.toMatchObject({
        appError: MemberErrorCode.INVALID_CREDENTIALS,
      });
      expect(repository.findOneBy).toHaveBeenCalledWith({
        email: signUpDto.email,
        status: ResourceStatus.NORMAL,
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      repository.save.mockImplementation((member: Member) =>
        Promise.resolve(member),
      );
    });

    it('전달된 필드만 수정하고 나머지는 유지한다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      const result = await service.update('member-uuid', {
        nickname: '새닉네임',
        age: 30,
      });

      expect(result.nickname).toBe('새닉네임');
      expect(result.age).toBe(30);
      expect(result.email).toBe(signUpDto.email); // 건드리지 않은 필드는 그대로
      expect(result.gender).toBeNull();
    });

    it('존재하지 않는 회원이면 NOT_FOUND 에러를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('없는-uuid', { nickname: '새닉네임' }),
      ).rejects.toMatchObject({ appError: MemberErrorCode.NOT_FOUND });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('currentPassword가 맞으면 newPassword를 해싱해 저장한다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      await service.update('member-uuid', {
        currentPassword: signUpDto.password,
        newPassword: 'brandNewPassword',
      });

      const saved = (await repository.save.mock.results[0].value) as Member;
      expect(saved.password).not.toBe('brandNewPassword');
      await expect(
        bcrypt.compare('brandNewPassword', saved.password!),
      ).resolves.toBe(true);
    });

    it('currentPassword가 틀리면 INVALID_CURRENT_PASSWORD 에러를 던지고 저장하지 않는다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      await expect(
        service.update('member-uuid', {
          currentPassword: 'wrongpassword',
          newPassword: 'brandNewPassword',
        }),
      ).rejects.toMatchObject({
        appError: MemberErrorCode.INVALID_CURRENT_PASSWORD,
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('newPassword가 없으면 비밀번호를 건드리지 않는다', async () => {
      const original = await buildMember();
      const originalHash = original.password;
      repository.findOneBy.mockResolvedValue(original);

      await service.update('member-uuid', {
        nickname: '새닉네임',
      });

      const saved = (await repository.save.mock.results[0].value) as Member;
      expect(saved.password).toBe(originalHash);
    });

    it('newPassword가 null이면 bcrypt.hash에 도달하지 않고 비밀번호를 유지한다', async () => {
      const original = await buildMember();
      const originalHash = original.password;
      repository.findOneBy.mockResolvedValue(original);

      // DTO를 우회해 null이 들어와도 서비스가 방어적으로 미변경 처리하는지 검증한다.
      await service.update('member-uuid', {
        nickname: '새닉네임',
        newPassword: null,
      } as unknown as UpdateMemberDto);

      const saved = (await repository.save.mock.results[0].value) as Member;
      expect(saved.password).toBe(originalHash);
    });

    it('소셜 전용 계정의 비밀번호 변경은 SOCIAL_ACCOUNT_NO_PASSWORD로 거부한다', async () => {
      const socialOnly = await buildMember();
      socialOnly.password = null;
      repository.findOneBy.mockResolvedValue(socialOnly);

      await expect(
        service.update('member-uuid', {
          currentPassword: 'whatever12',
          newPassword: 'brandNewPassword',
        }),
      ).rejects.toMatchObject({
        appError: MemberErrorCode.SOCIAL_ACCOUNT_NO_PASSWORD,
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('소셜 전용 계정도 비밀번호를 건드리지 않는 수정은 허용한다', async () => {
      const socialOnly = await buildMember();
      socialOnly.password = null;
      repository.findOneBy.mockResolvedValue(socialOnly);

      const result = await service.update('member-uuid', {
        nickname: '새닉네임',
      });

      expect(result.nickname).toBe('새닉네임');
    });

    it('응답에 password를 포함하지 않는다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      const result = await service.update('member-uuid', {
        nickname: '새닉네임',
      });

      expect(result).not.toHaveProperty('password');
    });
  });

  describe('findOneOrThrow', () => {
    it('존재하는 회원을 반환한다', async () => {
      const member = await buildMember();
      repository.findOneBy.mockResolvedValue(member);

      const result = await service.findOneOrThrow('member-uuid');

      expect(result).toBe(member);
      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'member-uuid',
        status: ResourceStatus.NORMAL,
      });
    });

    it('존재하지 않는 회원이면 NOT_FOUND 에러를 던진다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.findOneOrThrow('없는-uuid')).rejects.toMatchObject({
        appError: MemberErrorCode.NOT_FOUND,
      });
    });
  });

  describe('findByOAuthAccount', () => {
    const googleAccount = {
      provider: OAuthProviderType.GOOGLE,
      providerId: 'google-sub-1',
    };

    it('연동 행이 없으면 null을 반환하고 회원을 조회하지 않는다', async () => {
      oauthAccountRepository.findOneBy.mockResolvedValue(null);

      const result = await service.findByOAuthAccount(
        googleAccount.provider,
        googleAccount.providerId,
      );

      expect(result).toBeNull();
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('연동된 회원을 status=NORMAL 조건으로 조회해 반환한다', async () => {
      const member = await buildMember();
      oauthAccountRepository.findOneBy.mockResolvedValue({
        memberId: 'member-uuid',
      });
      repository.findOneBy.mockResolvedValue(member);

      const result = await service.findByOAuthAccount(
        googleAccount.provider,
        googleAccount.providerId,
      );

      expect(result).toBe(member);
      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'member-uuid',
        status: ResourceStatus.NORMAL,
      });
    });

    it('연동 행만 남고 회원이 탈퇴했으면 null을 반환한다', async () => {
      oauthAccountRepository.findOneBy.mockResolvedValue({
        memberId: 'member-uuid',
      });
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findByOAuthAccount(
          googleAccount.provider,
          googleAccount.providerId,
        ),
      ).resolves.toBeNull();
    });
  });

  describe('linkOAuthAccount', () => {
    it('기존 회원에 연동 행을 저장한다', async () => {
      oauthAccountRepository.save.mockImplementation(
        (account: MemberOAuthAccount) => Promise.resolve(account),
      );

      const result = await service.linkOAuthAccount('member-uuid', {
        provider: OAuthProviderType.GOOGLE,
        providerId: 'google-sub-1',
        email: signUpDto.email,
      });

      expect(result).toMatchObject({
        memberId: 'member-uuid',
        provider: OAuthProviderType.GOOGLE,
        providerId: 'google-sub-1',
        email: signUpDto.email,
      });
    });
  });

  describe('createWithOAuth', () => {
    const profile = {
      provider: OAuthProviderType.GOOGLE,
      providerId: 'google-sub-1',
      email: 'social@example.com',
      nickname: '소셜회원',
      profileImageUrl: 'https://cdn.example.com/profile/1.png',
    };

    it('비밀번호 없는 회원과 연동 행을 한 트랜잭션으로 저장한다', async () => {
      const result = await service.createWithOAuth(profile);

      expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
      expect(entityManager.save).toHaveBeenCalledTimes(2);

      const [savedMember, savedAccount] = entityManager.save.mock.calls.map(
        (call: [unknown]) => call[0],
      ) as [Member, MemberOAuthAccount];

      expect(savedMember.password).toBeNull();
      expect(savedMember.hasPassword()).toBe(false);
      expect(savedMember.email).toBe(profile.email);
      expect(savedMember.nickname).toBe(profile.nickname);
      expect(savedMember.profileImageUrl).toBe(profile.profileImageUrl);
      expect(savedMember.status).toBe(ResourceStatus.NORMAL);

      expect(savedAccount.memberId).toBe(savedMember.id);
      expect(savedAccount.provider).toBe(profile.provider);
      expect(savedAccount.providerId).toBe(profile.providerId);

      expect(result).toBe(savedMember);
    });

    it('동시 가입으로 이메일 unique 위반이 나면 EMAIL_ALREADY_EXISTS 에러를 던진다', async () => {
      repository.manager.transaction.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          pgDriverError('23505', MEMBER_EMAIL_UNIQUE),
        ),
      );

      await expect(service.createWithOAuth(profile)).rejects.toMatchObject({
        appError: MemberErrorCode.EMAIL_ALREADY_EXISTS,
      });
    });

    // 제약 이름을 모르면 이메일 중복으로 단정하지 않고 원본 에러를 전파해야 한다
    it('제약 이름이 없는 unique 위반은 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('23505'));
      repository.manager.transaction.mockRejectedValue(error);

      await expect(service.createWithOAuth(profile)).rejects.toBe(error);
    });

    it('unique 위반이 아닌 DB 에러는 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('08006'));
      repository.manager.transaction.mockRejectedValue(error);

      await expect(service.createWithOAuth(profile)).rejects.toBe(error);
    });
  });

  describe('findByIds', () => {
    it('빈 배열이면 레포지토리를 조회하지 않고 빈 배열을 반환한다', async () => {
      const result = await service.findByIds([]);

      expect(result).toEqual([]);
      expect(repository.findBy).not.toHaveBeenCalled();
    });

    it('id 목록으로 조회한 회원들을 반환한다', async () => {
      const members = [
        { ...(await buildMember()), id: 'id-1' },
        { ...(await buildMember()), id: 'id-2' },
      ];
      repository.findBy.mockResolvedValue(members);

      const result = await service.findByIds(['id-1', 'id-2']);

      expect(result).toBe(members);
      expect(repository.findBy).toHaveBeenCalledTimes(1);
      expect(repository.findBy).toHaveBeenCalledWith({
        id: In(['id-1', 'id-2']),
        status: ResourceStatus.NORMAL,
      });
    });
  });

  describe('deductSocialCredit', () => {
    const buildMemberWithCredit = async (
      socialCredit: number,
    ): Promise<Member> => Object.assign(await buildMember(), { socialCredit });

    it('차감량만큼 신뢰도를 줄여 저장한다', async () => {
      const member = await buildMemberWithCredit(100);
      repository.findOneBy.mockResolvedValue(member);

      await service.deductSocialCredit('member-uuid', 8);

      expect(member.socialCredit).toBe(92);
      expect(repository.save).toHaveBeenCalledWith(member);
    });

    it('차감량이 0이면 조회조차 하지 않는다', async () => {
      await service.deductSocialCredit('member-uuid', 0);

      expect(repository.findOneBy).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('탈퇴한 회원은 조용히 건너뛴다', async () => {
      // soft-delete된 회원은 status=NORMAL 필터에 걸려 조회되지 않는다.
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.deductSocialCredit('member-uuid', 8),
      ).resolves.toBeUndefined();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('트랜잭션 manager를 받으면 그 manager의 레포지토리로 저장한다', async () => {
      const member = await buildMemberWithCredit(100);
      const txRepository = {
        findOneBy: jest.fn().mockResolvedValue(member),
        save: jest.fn().mockResolvedValue(member),
      };
      const manager = { getRepository: jest.fn(() => txRepository) };

      await service.deductSocialCredit('member-uuid', 3, manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(Member);
      expect(txRepository.save).toHaveBeenCalledWith(member);
      // 판정 저장과 같은 트랜잭션에서 커밋되어야 하므로 기본 레포지토리를 쓰면 안 된다.
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('가입한 회원의 신뢰도는 만점에서 시작한다', () => {
      const member = Member.register({
        email: signUpDto.email,
        password: 'hash',
        nickname: signUpDto.nickname,
      });

      expect(member.socialCredit).toBe(INITIAL_SOCIAL_CREDIT);
    });
  });
});
