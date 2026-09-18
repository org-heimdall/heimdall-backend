import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { OAuthProviderType } from '../members.enums';
import { Member } from './member.entity';

@Entity('member_oauth_account')
@Unique(['provider', 'providerId'])
export class MemberOAuthAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @Column({ type: 'enum', enum: OAuthProviderType })
  provider: OAuthProviderType;

  // 공급자가 발급한 계정 고유 식별자(구글은 id token의 sub). 이메일과 달리 변하지 않는다.
  @Column({ type: 'varchar' })
  providerId: string;

  // 연동 시점의 공급자 이메일. 식별에는 쓰지 않고 어떤 계정으로 연동했는지 추적용으로만 둔다.
  @Column({ type: 'varchar' })
  email: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Member, { nullable: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  // 회원과 소셜 계정의 연동 행을 만드는 팩토리
  static link(params: {
    memberId: string;
    provider: OAuthProviderType;
    providerId: string;
    email: string;
  }): MemberOAuthAccount {
    const account = new MemberOAuthAccount();
    account.memberId = params.memberId;
    account.provider = params.provider;
    account.providerId = params.providerId;
    account.email = params.email;
    return account;
  }
}
