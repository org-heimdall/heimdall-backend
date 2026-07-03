import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  username: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_ROOT_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
  synchronize: false,
  migrations: [__dirname + '/src/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
});

export default AppDataSource;
