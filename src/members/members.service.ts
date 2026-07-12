import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === PG_UNIQUE_VIOLATION
    );
  }
}
