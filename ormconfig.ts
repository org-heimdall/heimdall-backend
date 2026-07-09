import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from './src/common/naming/snake-naming.strategy';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  username: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
  synchronize: true,
  migrations: [__dirname + '/src/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  namingStrategy: new SnakeNamingStrategy(),
});

export default AppDataSource;
