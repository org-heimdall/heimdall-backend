import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppError } from '../common/exceptions/app-error.interface';
import { GeneralException } from '../common/exceptions/general.exception';
import { getUniqueViolationConstraint } from '../common/exceptions/unique-violation.util';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MemberDto } from './dto/member.dto';
import { MEMBER_EMAIL_UNIQUE, Member } from './entities/member.entity';
import { MemberErrorCode } from './exceptions/member-error-code';
import { ResourceStatus } from '../common/entities/resource-status.enum';

const BCRYPT_SALT_ROUNDS = 10;

/**
 * member 테이블의 unique 제약 이름 → 도메인 에러.
 * unique 제약을 추가할 때 엔티티의 @Unique와 이 맵에 한 줄씩만 더하면 분류가 따라온다.
 */
const UNIQUE_VIOLATION_ERRORS: Record<string, AppError> = {
  [MEMBER_EMAIL_UNIQUE]: MemberErrorCode.EMAIL_ALREADY_EXISTS,
};

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

    const member = Member.register({
      email: createMemberDto.email,
      password,
      nickname: createMemberDto.nickname,
      gender: createMemberDto.gender,
      age: createMemberDto.age,
      profileImageUrl: createMemberDto.profileImageUrl,
    });

    try {
      const saved = await this.memberRepository.save(member);
      return MemberDto.from(saved);
    } catch (error) {
      const appError = this.resolveUniqueViolation(error);
      if (appError) {
        throw new GeneralException(appError);
      }
      throw error;
    }
  }

  async login(loginMemberDto: LoginMemberDto): Promise<MemberDto> {
    const member = await this.memberRepository.findOneBy({
      email: loginMemberDto.email,
      status: ResourceStatus.NORMAL,
    });

    // 회원이 없어도 더미 해시와 비교해 bcrypt 비용을 동일하게 치른다(타이밍 공격 완화).
    const passwordHash = member?.password ?? DUMMY_PASSWORD_HASH;
    const matches = await bcrypt.compare(loginMemberDto.password, passwordHash);

    // 이메일 미존재/비밀번호 불일치 모두 같은 예외로 처리해 존재 여부가 드러나지 않게 한다.
    if (!member || !matches) {
      throw new GeneralException(MemberErrorCode.INVALID_CREDENTIALS);
    }

    return MemberDto.from(member);
  }

  async update(
    memberId: string,
    updateMemberDto: UpdateMemberDto,
  ): Promise<MemberDto> {
    const member = await this.findOneOrThrow(memberId);

    const { currentPassword, newPassword } = updateMemberDto;

    // null/undefined는 비밀번호 미변경으로 취급해 bcrypt.hash에 도달하지 않게 한다.
    if (newPassword != null) {
      // DTO의 @ValidateIf가 newPassword와 currentPassword의 동반 전달을 보장한다.
      const matches = await bcrypt.compare(currentPassword!, member.password);
      if (!matches) {
        throw new GeneralException(MemberErrorCode.INVALID_CURRENT_PASSWORD);
      }
      member.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    }

    // 전달되지 않은 필드는 기존 값을 유지한다(부분 수정).
    // DTO를 통째로 넘기지 않고 필드를 명시해, 향후 DTO에 필드가 추가돼도 엔티티에 흘러들지 않게 한다.
    member.updateProfile({
      nickname: updateMemberDto.nickname,
      gender: updateMemberDto.gender,
      age: updateMemberDto.age,
      profileImageUrl: updateMemberDto.profileImageUrl,
    });

    const saved = await this.memberRepository.save(member);
    return MemberDto.from(saved);
  }

  // id로 회원을 조회하고, 없으면 GeneralException(NOT_FOUND)을 던진다.
  async findOneOrThrow(memberId: string): Promise<Member> {
    const member = await this.memberRepository.findOneBy({
      id: memberId,
      status: ResourceStatus.NORMAL,
    });
    if (!member) {
      throw new GeneralException(MemberErrorCode.NOT_FOUND);
    }
    return member;
  }

  // id 목록으로 회원을 배치 조회한다(호스트 프로필/참여자 목록 조립에 재사용).
  async findByIds(ids: string[]): Promise<Member[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.memberRepository.findBy({
      id: In(ids),
      status: ResourceStatus.NORMAL,
    });
  }

  // 위반된 제약 이름으로 unique 위반을 도메인 에러로 분류한다.
  // 매핑되지 않은 제약(또는 unique 위반이 아님)은 null을 반환해 호출부가 원본 에러를 전파하게 한다.
  // 추측으로 특정 에러에 흡수시키면 제약이 늘어날 때마다 오분류가 재발하기 때문이다.
  private resolveUniqueViolation(error: unknown): AppError | null {
    const constraint = getUniqueViolationConstraint(error);
    if (!constraint) {
      return null;
    }
    return UNIQUE_VIOLATION_ERRORS[constraint] ?? null;
  }
}
