import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 사실 검증 대상 선정을 위한 논증 컴포넌트 컬럼 확장.
 *
 * 1. claim_type — Analyzer가 붙이는 주장 유형. 검증 가능한 유형만 대상이 된다.
 * 2. fact_check_statement — 발언자·메타 표현을 뺀 검증 명제. 결과 카드에 이 문장이 나간다.
 * 3. claim_hash + partial unique index — 같은 토론에서 같은 주장을 두 번 검증 대상으로 만들지 않는다.
 * 4. fact_check_exclusion_reason — 서버 정책이 대상에서 뺀 이유(감사·튜닝용).
 * 5. duplicate_of_component_id — 같은 주장을 먼저 한 컴포넌트.
 *
 * 백필은 하지 않는다. 기존 행은 null로 남고 읽을 때 statement로 대신한다(claim_hash null은 unique 대상이 아니다).
 */
const CLAIM_TYPE = '"public"."debate_argument_component_claim_type_enum"';
const EXCLUSION_REASON =
  '"public"."debate_argument_component_fact_check_exclusion_reason_enum"';

export class FactCheckTargetColumns1789900000003 implements MigrationInterface {
  name = 'FactCheckTargetColumns1789900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE ${CLAIM_TYPE} AS ENUM('STATISTIC', 'CITED_SOURCE', 'DATE_EVENT', 'LAW_INSTITUTION', 'HISTORICAL_SCIENTIFIC', 'PREDICTION', 'NORMATIVE', 'META', 'OPINION')`,
    );
    await queryRunner.query(
      `CREATE TYPE ${EXCLUSION_REASON} AS ENUM('NON_FACTUAL', 'META_STATEMENT', 'DUPLICATE', 'OVER_LIMIT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_argument_component"
         ADD "claim_type" ${CLAIM_TYPE},
         ADD "fact_check_statement" text,
         ADD "claim_hash" character varying(64),
         ADD "fact_check_exclusion_reason" ${EXCLUSION_REASON},
         ADD "duplicate_of_component_id" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_argument_component_claim_hash" ON "debate_argument_component" ("debate_id", "claim_hash") WHERE "needs_fact_check" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_argument_component_claim_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_argument_component"
         DROP COLUMN "duplicate_of_component_id",
         DROP COLUMN "fact_check_exclusion_reason",
         DROP COLUMN "claim_hash",
         DROP COLUMN "fact_check_statement",
         DROP COLUMN "claim_type"`,
    );
    await queryRunner.query(`DROP TYPE ${EXCLUSION_REASON}`);
    await queryRunner.query(`DROP TYPE ${CLAIM_TYPE}`);
  }
}
