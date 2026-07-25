import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../common/entities/soft-deletable.entity';

@Entity('member')
export class Member extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar' })
  password: string;

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
    password: string;
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
