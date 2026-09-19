import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * theme.name을 계약의 category 코드(대문자 영어)로 맞춘다.
 *
 * SeedThemes는 처음부터 코드로 넣었지만, development에서만 도는 SeedService는 한글 이름으로 넣고
 * 있었다. 그래서 두 곳을 모두 거친 DB에는 같은 테마가 한글·코드 두 벌로 남아 있고, 그 전에 만들어진
 * 커뮤니티는 한글 쪽을 참조한다. 프론트는 코드를 보내므로 한글 행은 커뮤니티 생성에서 영영 매칭되지
 * 않는다 — 여기서 한 벌로 합친다.
 *
 * 값 목록을 SeedService에서 import하지 않고 박아 두는 이유는 SeedThemes와 같다(docs/migration.md).
 */
const THEME_NAME_MAP: ReadonlyArray<readonly [string, string]> = [
  ['정치', 'POLITICS'],
  ['경제', 'ECONOMY'],
  ['사회', 'SOCIETY'],
  ['문화', 'CULTURE'],
  ['스포츠', 'SPORTS'],
  ['일상', 'DAILY'],
  ['코미디', 'COMEDY'],
  ['기타', 'ETC'],
];

const LEGACY_NAMES = THEME_NAME_MAP.map(([legacy]) => legacy);
const CODE_NAMES = THEME_NAME_MAP.map(([, code]) => code);

export class NormalizeThemeNamesToCodes1789900000000 implements MigrationInterface {
  name = 'NormalizeThemeNamesToCodes1789900000000';

  /**
   * 1) 코드 테마가 이미 있으면 커뮤니티를 그쪽으로 옮기고 한글 행을 지운다(중복 병합).
   * 2) 짝이 없는 한글 행은 이름만 바꾼다.
   * 순서가 중요하다 — 2를 먼저 하면 unique 제약이 없는 theme.name에 같은 코드가 두 개 생긴다.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "community" c
       SET "theme_id" = code."id"
       FROM unnest($1::text[], $2::text[]) AS m("legacy", "code")
       JOIN "theme" legacy ON legacy."name" = m."legacy"
       JOIN "theme" code ON code."name" = m."code"
       WHERE c."theme_id" = legacy."id"`,
      [LEGACY_NAMES, CODE_NAMES],
    );

    await queryRunner.query(
      `DELETE FROM "theme" legacy
       USING unnest($1::text[], $2::text[]) AS m("legacy", "code"), "theme" code
       WHERE legacy."name" = m."legacy" AND code."name" = m."code"`,
      [LEGACY_NAMES, CODE_NAMES],
    );

    await queryRunner.query(
      `UPDATE "theme" t
       SET "name" = m."code"
       FROM unnest($1::text[], $2::text[]) AS m("legacy", "code")
       WHERE t."name" = m."legacy"
         AND NOT EXISTS (
           SELECT 1 FROM "theme" other WHERE other."name" = m."code"
         )`,
      [LEGACY_NAMES, CODE_NAMES],
    );
  }

  // 이름만 되돌린다. up에서 병합하며 지운 중복 행과 그 행을 가리키던 참조는 복구할 수 없다.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "theme" t
       SET "name" = m."legacy"
       FROM unnest($1::text[], $2::text[]) AS m("legacy", "code")
       WHERE t."name" = m."code"
         AND NOT EXISTS (
           SELECT 1 FROM "theme" other WHERE other."name" = m."legacy"
         )`,
      [LEGACY_NAMES, CODE_NAMES],
    );
  }
}
