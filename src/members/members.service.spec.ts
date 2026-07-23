import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { MembersService } from './members.service';
import { UpdateMemberDto } from './dto/update-member.dto';
import { Member } from './entities/member.entity';
import { MemberErrorCode } from './exceptions/member-error-code';
import { ResourceStatus } from '../common/entities/resource-status.enum';

describe('MembersService', () => {
  let service: MembersService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    findBy: jest.Mock;
  };

  const signUpDto = {
    email: 'heimdall@example.com',
    password: 'password1234',
    nickname: '헤임달',
  };

  /** pg 드라이버가 던지는 에러 모양(code 프로퍼티를 가진 Error) */
  const pgDriverError = (code: string): Error =>
    Object.assign(new Error(`pg error ${code}`), { code });

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
    repository = {
      create: jest.fn((entity: Member) => entity),
      save: jest.fn(),
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: getRepositoryToken(Member), useValue: repository },
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
        bcrypt.compare(signUpDto.password, savedMember!.password),
      ).resolves.toBe(true);

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

    it('이메일이 중복되면 EMAIL_ALREADY_EXISTS 에러를 던진다', async () => {
      repository.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], pgDriverError('23505')),
      );

      await expect(service.signUp(signUpDto)).rejects.toMatchObject({
        appError: MemberErrorCode.EMAIL_ALREADY_EXISTS,
      });
    });

    it('unique 위반이 아닌 DB 에러는 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('08006'));
      repository.save.mockRejectedValue(error);

      await expect(service.signUp(signUpDto)).rejects.toBe(error);
    });
  });

  describe('login', () => {
    it('이메일과 비밀번호가 일치하면 memberId를 반환한다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      const result = await service.login({
        email: signUpDto.email,
        password: signUpDto.password,
      });

      expect(result.memberId).toBe('member-uuid');
      expect(result).not.toHaveProperty('password');
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
        bcrypt.compare('brandNewPassword', saved.password),
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

      await service.update('member-uuid', { nickname: '새닉네임' });

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
});
