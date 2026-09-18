import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * theme은 커뮤니티 생성에 반드시 필요한 기준 데이터이고, SeedService는 development에서만 돌기 때문에
 * 운영 DB에는 마이그레이션으로 넣는다.
 *
 * 이름 목록을 SeedService의 THEME_SEEDS에서 import하지 않고 여기에 박아 두는 이유: 마이그레이션은
 * 실행 당시를 기록한 스냅샷이라 나중에 상수가 바뀌어도 과거 실행 결과가 달라지면 안 된다.
 * 테마를 추가·변경할 때는 THEME_SEEDS와 함께 새 마이그레이션을 쓴다(docs/migration.md).
 */
const THEME_NAMES = [
  '정치',
  '경제',
  '사회',
  '문화',
  '스포츠',
  '일상',
  '코미디',
  '기타',
];

export class SeedThemes1789735588824 implements MigrationInterface {
  name = 'SeedThemes1789735588824';

  // 이름이 같은 테마가 없을 때만 넣는다. theme.name에 unique 제약이 없어 ON CONFLICT를 쓸 수 없고,
  // development에서 SeedService가 이미 같은 이름으로 넣어 둔 DB에서도 중복이 생기면 안 된다.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "theme" ("name")
       SELECT s."name"
       FROM unnest($1::text[]) AS s("name")
       WHERE NOT EXISTS (
         SELECT 1 FROM "theme" t WHERE t."name" = s."name"
       )`,
      [THEME_NAMES],
    );
  }

  // 커뮤니티가 참조 중인 테마는 남긴다. FK 위반으로 롤백 전체가 실패하는 것보다,
  // 쓰이고 있는 기준 데이터를 보존하는 쪽이 안전하다.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "theme" AS t
       WHERE t."name" = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM "community" c WHERE c."theme_id" = t."id"
         )`,
      [THEME_NAMES],
    );
  }
}
