import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { MemberDto } from './dto/member.dto';
import { Member } from './entities/member.entity';

const BCRYPT_SALT_ROUNDS = 10;

/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

const INVALID_CREDENTIALS = '이메일 또는 비밀번호가 올바르지 않습니다.';

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
  ) {}

  async signUp(createMemberDto: CreateMemberDto): Promise<MemberDto> {
    const password = await bcrypt.hash(
      createMemberDto.password,
      BCRYPT_SALT_ROUNDS,
    );

    const member = this.memberRepository.create({
      email: createMemberDto.email,
      password,
      nickname: createMemberDto.nickname,
      gender: createMemberDto.gender ?? null,
      age: createMemberDto.age ?? null,
      profileImageUrl: createMemberDto.profileImageUrl ?? null,
    });

    try {
      const saved = await this.memberRepository.save(member);
      return MemberDto.from(saved);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('이미 가입된 이메일입니다.');
      }
      throw error;
    }
  }

  async login(loginMemberDto: LoginMemberDto): Promise<MemberDto> {
    const member = await this.memberRepository.findOneBy({
      email: loginMemberDto.email,
    });

    // 이메일 존재 여부가 드러나지 않도록 두 실패 경우 모두 같은 예외를 던진다.
    if (!member) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const matches = await bcrypt.compare(
      loginMemberDto.password,
      member.password,
    );
    if (!matches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return MemberDto.from(member);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === PG_UNIQUE_VIOLATION
    );
  }
}
