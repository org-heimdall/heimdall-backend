import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('member')
export class Member {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar' })
  email: string;

  @Column({ type: 'varchar' })
  password: string;

  @Column({ type: 'varchar' })
  nickname: string;

  @Column({ type: 'varchar', nullable: true })
  gender: string | null;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ name: 'profile_image_url', type: 'varchar', nullable: true })
  profileImageUrl: string | null;

  @Column({ name: 'social_credit', type: 'double precision' })
  socialCredit: number;

  @Column({ type: 'double precision' })
  rating: number;
}
