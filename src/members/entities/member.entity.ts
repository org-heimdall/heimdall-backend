import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

/**
 * 이메일 unique 제약 이름. 자동 생성 이름(UQ_<해시>)은 코드에서 참조할 수 없어 명시적으로 부여한다.
 * 서비스가 unique 위반을 제약 이름으로 분류하므로 엔티티와 분류기의 단일 출처가 된다.
 */
export const MEMBER_EMAIL_UNIQUE = 'UQ_member_email';
export const INITIAL_SOCIAL_CREDIT = 100;

@Entity('member')
@Unique(MEMBER_EMAIL_UNIQUE, ['email'])
export class Member extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  email: string;

  // 소셜 전용 계정은 비밀번호가 없다(null). 비밀번호를 쓰는 흐름은 null을 먼저 걸러야 한다.
  @Column({ type: 'varchar', nullable: true })
  password: string | null;

  @Column({ type: 'varchar' })
  nickname: string;

  @Column({ type: 'varchar', nullable: true })
  gender: string | null;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'varchar', nullable: true })
  profileImageUrl: string | null;

  @Column({ type: 'double precision', default: INITIAL_SOCIAL_CREDIT })
  socialCredit: number;

  @Column({ type: 'double precision', default: 0 })
  rating: number;

  static register(params: {
    email: string;
    password: string | null;
    nickname: string;
    gender?: string | null;
    age?: number | null;
    profileImageUrl?: string | null;
  }): Member {
    const member = new Member();
    member.email = params.email;
    member.password = params.password;
    member.nickname = params.nickname;
    member.gender = params.gender ?? null;
    member.age = params.age ?? null;
    member.profileImageUrl = params.profileImageUrl ?? null;
    member.socialCredit = INITIAL_SOCIAL_CREDIT;
    member.rating = 0;
    return member;
  }

  // 소셜 가입 불변식(비밀번호 없음 + 나머지는 일반 가입과 동일)을 강제하는 팩토리
  static registerWithOAuth(params: {
    email: string;
    nickname: string;
    profileImageUrl?: string | null;
  }): Member {
    return Member.register({
      email: params.email,
      password: null,
      nickname: params.nickname,
      profileImageUrl: params.profileImageUrl,
    });
  }

  // 비밀번호 로그인을 쓸 수 있는 계정인지(소셜 전용 계정은 false)
  hasPassword(): boolean {
    return this.password !== null;
  }

  // 위반 판정에 따른 신뢰도 차감. 추이 관찰을 위해 하한선 없이 음수까지 허용(임시).
  deductSocialCredit(amount: number): void {
    if (amount <= 0) {
      return;
    }
    this.socialCredit -= amount;
  }

  // 전달된 필드만 갱신한다(undefined는 미변경). 부분 수정 규칙을 엔티티가 소유
  updateProfile(profile: {
    nickname?: string;
    gender?: string | null;
    age?: number | null;
    profileImageUrl?: string | null;
  }): void {
    if (profile.nickname !== undefined) this.nickname = profile.nickname;
    if (profile.gender !== undefined) this.gender = profile.gender;
    if (profile.age !== undefined) this.age = profile.age;
    if (profile.profileImageUrl !== undefined) {
      this.profileImageUrl = profile.profileImageUrl;
    }
  }
}
