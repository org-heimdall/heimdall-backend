import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

@Entity('member')
export class Member extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
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

  @Column({ type: 'double precision', default: 0 })
  socialCredit: number;

  @Column({ type: 'double precision', default: 0 })
  rating: number;

  // 가입 시 초기 상태 불변식(평판/신뢰도 0, 선택 필드는 null 정규화)을 강제하는 팩토리
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
    member.socialCredit = 0;
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
