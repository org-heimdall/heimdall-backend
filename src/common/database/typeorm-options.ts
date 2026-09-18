import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from '../naming/snake-naming.strategy';

export interface DatabaseConnectionEnv {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

// 앱 부팅(AppModule)과 TypeORM CLI(src/data-source.ts)가 같은 접속 설정을 쓰도록 한곳에서 만든다.
// glob을 이 파일의 __dirname 기준으로 잡아, ts-node로 src를 돌릴 때와 dist로 컴파일된 뒤 양쪽에서
// 같은 코드가 각자의 루트(src/ 또는 dist/)를 가리키게 한다.
export function buildTypeOrmOptions(
  env: DatabaseConnectionEnv,
): DataSourceOptions {
  // glob은 Windows에서도 '/'만 구분자로 인정하므로 join 결과의 역슬래시를 되돌린다.
  const root = join(__dirname, '..', '..').replaceAll('\\', '/');

  return {
    type: 'postgres',
    host: env.host,
    port: env.port,
    username: env.username,
    password: env.password,
    database: env.database,
    entities: [`${root}/**/*.entity{.ts,.js}`],
    migrations: [`${root}/migrations/*{.ts,.js}`],
    migrationsTableName: 'migrations',
    namingStrategy: new SnakeNamingStrategy(),
    // 스키마는 모든 환경에서 마이그레이션만으로 바꾼다. synchronize는 켜지 않는다.
    synchronize: false,
    // 적용은 배포 시 수동(docs/migration.md)으로 하므로 부팅 중에 돌리지 않는다.
    migrationsRun: false,
  };
}
