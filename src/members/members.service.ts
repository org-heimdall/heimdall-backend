import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuthSessionService } from '../auth/auth-session.service';
import { AuthTokenDto } from '../auth/dto/auth-token.dto';
import { GeneralException } from '../common/exceptions/general.exception';
import { CreateMemberDto } from './dto/create-member.dto';
import { LoginMemberDto } from './dto/login-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MemberDto } from './dto/member.dto';
import { Member } from './entities/member.entity';
import { MemberOAuthAccount } from './entities/member-oauth-account.entity';
import { MemberErrorCode } from './exceptions/member-error-code';
import { OAuthProviderType } from './members.enums';
import { ResourceStatus } from '../common/entities/resource-status.enum';

/** 소셜 계정 연동 행을 만들 때 필요한 값 */
interface OAuthAccountLink {
  provider: OAuthProviderType;
  providerId: string;
  email: string;
}

const BCRYPT_SALT_ROUNDS = 10;

/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

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
    @InjectRepository(MemberOAuthAccount)
    private readonly oauthAccountRepository: Repository<MemberOAuthAccount>,
    private readonly authSessionService: AuthSessionService,
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
      if (this.isUniqueViolation(error)) {
        throw new GeneralException(MemberErrorCode.EMAIL_ALREADY_EXISTS);
      }
      throw error;
    }
  }

  async login(loginMemberDto: LoginMemberDto): Promise<AuthTokenDto> {
    const member = await this.memberRepository.findOneBy({
      email: loginMemberDto.email,
      status: ResourceStatus.NORMAL,
    });

    // 회원이 없어도(그리고 비밀번호가 없는 소셜 전용 계정이어도) 더미 해시와 비교해
    // bcrypt 비용을 동일하게 치른다(타이밍 공격 완화). 더미 해시는 어떤 입력과도 일치하지 않으므로
    // 소셜 전용 계정의 비밀번호 로그인은 INVALID_CREDENTIALS로 거부된다.
    const passwordHash = member?.password ?? DUMMY_PASSWORD_HASH;
    const matches = await bcrypt.compare(loginMemberDto.password, passwordHash);

    // 이메일 미존재/비밀번호 불일치 모두 같은 예외로 처리해 존재 여부가 드러나지 않게 한다.
    if (!member || !matches) {
      throw new GeneralException(MemberErrorCode.INVALID_CREDENTIALS);
    }

    // 로컬 로그인도 소셜 로그인과 같은 세션(JWT)을 발급받는다.
    return this.authSessionService.start(MemberDto.from(member));
  }

  async update(
    memberId: string,
    updateMemberDto: UpdateMemberDto,
  ): Promise<MemberDto> {
    const member = await this.findOneOrThrow(memberId);

    const { currentPassword, newPassword } = updateMemberDto;

    // null/undefined는 비밀번호 미변경으로 취급해 bcrypt.hash에 도달하지 않게 한다.
    if (newPassword != null) {
      // 소셜 전용 계정은 대조할 현재 비밀번호가 없다. 비밀번호 설정은 별도 흐름으로 다룬다.
      if (!member.hasPassword()) {
        throw new GeneralException(MemberErrorCode.SOCIAL_ACCOUNT_NO_PASSWORD);
      }

      // DTO의 @ValidateIf가 newPassword와 currentPassword의 동반 전달을 보장한다.
      const matches = await bcrypt.compare(currentPassword!, member.password!);
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

  // 연동 이력으로 회원을 찾는다. 연동 행만 남고 회원이 탈퇴한 경우도 미연동으로 취급한다.
  async findByOAuthAccount(
    provider: OAuthProviderType,
    providerId: string,
  ): Promise<Member | null> {
    const account = await this.oauthAccountRepository.findOneBy({
      provider,
      providerId,
    });
    if (!account) {
      return null;
    }
    return this.memberRepository.findOneBy({
      id: account.memberId,
      status: ResourceStatus.NORMAL,
    });
  }

  // 이메일로 회원을 찾는다(소셜 프로필과 기존 로컬 계정의 자동 연동 판단에 쓴다).
  async findByEmail(email: string): Promise<Member | null> {
    return this.memberRepository.findOneBy({
      email,
      status: ResourceStatus.NORMAL,
    });
  }

  // 기존 회원에 소셜 계정을 연동한다. 자동 연동 허용 여부(이메일 검증 등)는 호출자가 판단한다.
  async linkOAuthAccount(
    memberId: string,
    link: OAuthAccountLink,
  ): Promise<MemberOAuthAccount> {
    return this.oauthAccountRepository.save(
      MemberOAuthAccount.link({ memberId, ...link }),
    );
  }

  /**
   * 소셜 프로필로 회원을 새로 만든다(비밀번호 없음).
   * 회원과 연동 행은 한 트랜잭션으로 묶어 연동되지 않은 고아 회원이 남지 않게 한다.
   */
  async createWithOAuth(
    link: OAuthAccountLink & {
      nickname: string;
      profileImageUrl?: string | null;
    },
  ): Promise<Member> {
    const member = Member.registerWithOAuth({
      email: link.email,
      nickname: link.nickname,
      profileImageUrl: link.profileImageUrl,
    });

    try {
      return await this.memberRepository.manager.transaction(
        async (manager) => {
          const saved = await manager.save(member);
          await manager.save(
            MemberOAuthAccount.link({
              memberId: saved.id,
              provider: link.provider,
              providerId: link.providerId,
              email: link.email,
            }),
          );
          return saved;
        },
      );
    } catch (error) {
      // 동시 요청이 같은 이메일/연동을 먼저 만든 경우. 클라이언트가 재시도하면 연동 조회로 풀린다.
      if (this.isUniqueViolation(error)) {
        throw new GeneralException(MemberErrorCode.EMAIL_ALREADY_EXISTS);
      }
      throw error;
    }
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === PG_UNIQUE_VIOLATION
    );
  }
}
