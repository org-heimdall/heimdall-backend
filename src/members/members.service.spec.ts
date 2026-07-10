import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { MembersService } from './members.service';
import { Member } from './entities/member.entity';

describe('MembersService', () => {
  let service: MembersService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
  };

  const signUpDto = {
    email: 'heimdall@example.com',
    password: 'password1234',
    nickname: '헤임달',
  };

  /** pg 드라이버가 던지는 에러 모양(code 프로퍼티를 가진 Error) */
  const pgDriverError = (code: string): Error =>
    Object.assign(new Error(`pg error ${code}`), { code });

  beforeEach(async () => {
    repository = {
      create: jest.fn((entity: Member) => entity),
      save: jest.fn(),
      findOneBy: jest.fn(),
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

    it('이메일이 중복되면 ConflictException을 던진다', async () => {
      repository.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], pgDriverError('23505')),
      );

      await expect(service.signUp(signUpDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('unique 위반이 아닌 DB 에러는 그대로 전파한다', async () => {
      const error = new QueryFailedError('INSERT', [], pgDriverError('08006'));
      repository.save.mockRejectedValue(error);

      await expect(service.signUp(signUpDto)).rejects.toBe(error);
    });
  });

  describe('login', () => {
    const buildMember = async (): Promise<Member> => ({
      id: 'member-uuid',
      email: signUpDto.email,
      password: await bcrypt.hash(signUpDto.password, 10),
      nickname: signUpDto.nickname,
      gender: null,
      age: null,
      profileImageUrl: null,
      socialCredit: 0,
      rating: 0,
    });

    it('이메일과 비밀번호가 일치하면 memberId를 반환한다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      const result = await service.login({
        email: signUpDto.email,
        password: signUpDto.password,
      });

      expect(result.memberId).toBe('member-uuid');
      expect(result).not.toHaveProperty('password');
    });

    it('존재하지 않는 이메일이면 UnauthorizedException을 던진다', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever12' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('비밀번호가 틀리면 UnauthorizedException을 던진다', async () => {
      repository.findOneBy.mockResolvedValue(await buildMember());

      await expect(
        service.login({ email: signUpDto.email, password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
