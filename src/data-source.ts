import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './common/database/typeorm-options';

// TypeORM CLI 전용 DataSource. AppModule과 같은 옵션 빌더를 써서 접속 설정이 갈라지지 않게 한다.
// src에 두는 이유: 빌드 산출물(dist/data-source.js)이 배포 아티팩트에 실려야
// 서버에서 ts-node 없이 마이그레이션을 돌릴 수 있다(docs/migration.md).
const AppDataSource = new DataSource(
  buildTypeOrmOptions({
    host: process.env.PG_HOST as string,
    port: Number(process.env.PG_PORT ?? 5432),
    username: process.env.PG_USER ?? 'postgres',
    password: process.env.PG_PASSWORD as string,
    database: process.env.PG_DATABASE as string,
  }),
);

export default AppDataSource;
