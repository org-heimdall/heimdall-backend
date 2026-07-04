import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('theme')
export class Theme {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar' })
  name: string;
}
