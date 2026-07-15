import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MemberDto } from './dto/member.dto';
import { Member } from './entities/member.entity';

const BCRYPT_SALT_ROUNDS = 10;

/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

const INVALID_CREDENTIALS = '이메일 또는 비밀번호가 올바르지 않습니다.';

/**
 * 존재하지 않는 이메일로 로그인해도 실제 회원과 동일한 bcrypt 비용을 치르게 하는 더미 해시.
 * 저장 해시와 동일한 cost(10 rounds)라 비교 시간이 같아 이메일 존재 여부가 타이밍으로 드러나지 않는다.
 */
const DUMMY_PASSWORD_HASH =
  '$2b$10$P3jRv..bS0gDS8tKkfnkmOrEIlvumxbN8oBrj0mCkTTy6hSPGp.2';

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

    // 회원이 없어도 더미 해시와 비교해 bcrypt 비용을 동일하게 치른다(타이밍 공격 완화).
    const passwordHash = member?.password ?? DUMMY_PASSWORD_HASH;
    const matches = await bcrypt.compare(loginMemberDto.password, passwordHash);

    // 이메일 미존재/비밀번호 불일치 모두 같은 예외로 처리해 존재 여부가 드러나지 않게 한다.
    if (!member || !matches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return MemberDto.from(member);
  }

  async update(
    memberId: string,
    updateMemberDto: UpdateMemberDto,
  ): Promise<MemberDto> {
    const member = await this.memberRepository.findOneBy({ id: memberId });
    if (!member) {
      throw new NotFoundException('회원을 찾을 수 없습니다.');
    }

    const { currentPassword, newPassword, ...profile } = updateMemberDto;

    // null/undefined는 비밀번호 미변경으로 취급해 bcrypt.hash에 도달하지 않게 한다.
    if (newPassword != null) {
      // DTO의 @ValidateIf가 newPassword와 currentPassword의 동반 전달을 보장한다.
      const matches = await bcrypt.compare(currentPassword!, member.password);
      if (!matches) {
        throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');
      }
      member.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    }

    // 전달되지 않은 필드는 기존 값을 유지한다(부분 수정).
    if (profile.nickname !== undefined) member.nickname = profile.nickname;
    if (profile.gender !== undefined) member.gender = profile.gender;
    if (profile.age !== undefined) member.age = profile.age;
    if (profile.profileImageUrl !== undefined) {
      member.profileImageUrl = profile.profileImageUrl;
    }

    const saved = await this.memberRepository.save(member);
    return MemberDto.from(saved);
  }

  // id 목록으로 회원을 배치 조회한다(호스트 프로필/참여자 목록 조립에 재사용).
  async findByIds(ids: string[]): Promise<Member[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.memberRepository.findBy({ id: In(ids) });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === PG_UNIQUE_VIOLATION
    );
  }
}
