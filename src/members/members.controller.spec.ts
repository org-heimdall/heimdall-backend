import { Test, TestingModule } from '@nestjs/testing';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MemberDto } from './dto/member.dto';

describe('MembersController', () => {
  let controller: MembersController;
  let service: { signUp: jest.Mock; login: jest.Mock };

  const memberDto: MemberDto = {
    memberId: 'member-uuid',
    email: 'heimdall@example.com',
    nickname: '헤임달',
    gender: null,
    age: null,
    profileImageUrl: null,
    socialCredit: 0,
    rating: 0,
  };

  beforeEach(async () => {
    service = {
      signUp: jest.fn().mockResolvedValue(memberDto),
      login: jest.fn().mockResolvedValue(memberDto),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembersController],
      providers: [{ provide: MembersService, useValue: service }],
    }).compile();

    controller = module.get<MembersController>(MembersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('회원가입 요청을 서비스에 위임하고 memberId를 반환한다', async () => {
    const request = {
      email: 'heimdall@example.com',
      password: 'password1234',
      nickname: '헤임달',
    };

    await expect(controller.signUp(request)).resolves.toEqual(memberDto);
    expect(service.signUp).toHaveBeenCalledWith(request);
  });

  it('로그인 요청을 서비스에 위임하고 memberId를 반환한다', async () => {
    const request = {
      email: 'heimdall@example.com',
      password: 'password1234',
    };

    await expect(controller.login(request)).resolves.toEqual(memberDto);
    expect(service.login).toHaveBeenCalledWith(request);
  });
});
