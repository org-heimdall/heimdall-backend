import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('theme')
export class Theme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;
}
