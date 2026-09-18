# 마이그레이션 가이드

## 원칙

스키마를 바꾸는 유일한 수단은 **마이그레이션**이다. `synchronize`는 모든 환경에서 `false`이며
(`src/common/database/typeorm-options.ts`), 엔티티를 고쳤다면 마이그레이션도 같은 PR에 포함한다.

접속 설정은 `buildTypeOrmOptions()` 한 곳에서 만든다. 앱 부팅(`AppModule`)과 TypeORM CLI
(`src/data-source.ts`)가 이 함수를 공유하므로 두 경로의 설정이 갈라지지 않는다.

## 로컬 개발

DB/Redis만 컨테이너로 띄우고 앱은 호스트에서 돌리는 구성이라면 `.env`의 `PG_HOST`·`REDIS_HOST`는
`localhost`여야 한다. `postgres`/`redis`는 compose 네트워크 안에서만 해석되는 서비스 이름이다.

```bash
docker compose up -d postgres redis
npm run migration:run        # 스키마 최신화
npm run start:dev
```

엔티티를 수정한 뒤:

```bash
npm run migration:generate -- src/migrations/<이름>
npm run migration:run
```

`migration:generate`는 **현재 DB와 엔티티의 차이**를 뽑는다. 초기 스키마처럼 전체를 다시 뽑아야 하면
빈 DB를 기준으로 돌려야 한다.

| 명령 | 설명 |
| --- | --- |
| `npm run migration:create -- src/migrations/<이름>` | 빈 마이그레이션 생성(기준 데이터 등 직접 작성할 때) |
| `npm run migration:generate -- src/migrations/<이름>` | 엔티티와 DB 차이로 마이그레이션 생성 |
| `npm run migration:run` | 미적용 마이그레이션 적용 |
| `npm run migration:revert` | 마지막 마이그레이션 1건 롤백 |
| `npm run migration:show` | 적용 상태 확인(`[X]` 적용됨, `[ ]` 미적용) |

## 배포 (수동 적용)

배포 아티팩트에는 `src/`와 ts-node가 없다(`npm ci --omit=dev`로 잘린다). 그래서 서버에서는
컴파일된 `dist/data-source.js`를 쓰는 `*:prod` 스크립트를 쓴다. `typeorm`·`dotenv`는 prod
의존성이라 pruning 후에도 남는다.

**작업 순서**

1. 배포 워크플로(`main_deploy.yml`)가 EC2로 산출물을 옮기고 `backend` 컨테이너를 띄운다.
2. EC2에 접속한다. `ssh -i <키> <user>@<host>`
3. `cd ~/nest-server`
4. 적용 상태를 먼저 확인한다. 미적용 항목이 `[ ]`로 보인다.
   ```bash
   docker compose run --rm backend npm run migration:show:prod
   ```
5. **DB를 백업한다.** 되돌릴 수 없는 마이그레이션(컬럼/테이블 DROP)이 섞여 있으면 필수다.
   ```bash
   docker compose exec postgres pg_dump -U "$PG_USER" "$PG_DATABASE" > backup-$(date +%F-%H%M).sql
   ```
6. 적용한다.
   ```bash
   docker compose run --rm backend npm run migration:run:prod
   ```
7. 다시 `migration:show:prod`로 전부 `[X]`인지 확인하고, 앱 로그에 DB 에러가 없는지 본다.

롤백이 필요하면 `docker compose run --rm backend npm run migration:revert:prod`로 1건씩 되돌린다.
여러 건이면 횟수만큼 반복해야 한다.

> 앱은 부팅 중에 마이그레이션을 돌리지 않는다(`migrationsRun: false`). 스키마가 코드보다 뒤쳐진
> 상태로 배포하면 런타임 에러가 나므로, 4~6단계를 **앱을 재기동하기 전에** 끝내는 편이 안전하다.

## 알려진 함정

- **jsonb default 오탐.** `migration:generate`를 돌리면 `sources`·`side_a_violations`·
  `side_b_violations` 세 컬럼에 대한 `ALTER COLUMN ... SET DEFAULT '[]'::jsonb`가 매번 따라붙는다.
  DB의 실제 값과 완전히 동일한 no-op으로, TypeORM이 함수형 default를 정규화하지 못해 생기는 오탐이다.
  생성된 파일에서 지우고 커밋한다.
- **`uuid-ossp` 확장.** 엔티티의 PK가 `uuid_generate_v4()`를 쓰므로 이 확장이 필요하다. TypeORM
  v1.0이 마이그레이션 중 자동 설치하지만, **DB 유저에게 확장 설치 권한이 있을 때만** 된다. RDS 등
  관리형 DB로 옮긴다면 먼저 `CREATE EXTENSION "uuid-ossp";`가 되는지 확인한다.
- **시드.** `SeedService`는 `NODE_ENV=development`에서만 동작하므로 운영 DB의 기준 데이터는
  마이그레이션이 책임진다. `theme` 8종은 `SeedThemes` 마이그레이션이 넣는다.
- **기준 데이터를 바꿀 때.** 마이그레이션은 실행 당시를 기록한 스냅샷이라 `SeedService`의 상수를
  import하지 않고 값을 박아 둔다. 따라서 테마를 추가·변경하려면 `SeedService`의 `THEME_SEEDS`와
  **새 마이그레이션을 함께** 써야 한다. 기존 `SeedThemes` 파일을 고치면 이미 적용된 환경에는
  반영되지 않는다.
- **`theme.name`에는 unique 제약이 없다.** `SeedService`와 `SeedThemes` 모두 `name`을 멱등
  판별 키로 쓰지만 DB가 중복을 막아 주지는 않으므로, 두 곳 다 "같은 이름이 없을 때만 INSERT"로
  직접 막고 있다.
