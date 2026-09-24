import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 토론 종료 결과를 영속화하기 위한 스키마 변경.
 *
 * 1. community_message.member_id를 nullable로 — 서버가 만드는 시스템 메시지(토론 시작·결과·기권·시간 초과)는
 *    작성자가 없다.
 * 2. debate.end_reason 추가 — FAILED의 원인(기권·전체 시간 초과·판정 실패)을 구분해야 /judge/retry가
 *    판정 실패 토론만 되살릴 수 있다.
 * 3. 백필 — 기존 FAILED 토론은 승자가 있으면 기권, 없으면 판정 실패다(전체 시간 초과 종료는 이번에 생긴다).
 *    이미 끝난 토론의 커뮤니티가 ACTIVE로 남아 있으면 WAITING으로 되돌린다.
 */
const END_REASON_TYPE = '"public"."debate_end_reason_enum"';

// src/debates/debates.service.ts의 ACTIVE_DEBATE_STATUSES와 같은 값. 마이그레이션은 스냅샷이라 값을 박아 둔다.
const ACTIVE_DEBATE_STATUSES = `'READY', 'IN_PROGRESS', 'DEBATE_FINALIZED', 'JUDGING'`;

export class DebateOutcomePersistence1789900000002 implements MigrationInterface {
  name = 'DebateOutcomePersistence1789900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "member_id" DROP NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE ${END_REASON_TYPE} AS ENUM('ALL_TURNS_FINALIZED', 'FORFEIT', 'TOTAL_TIME_EXPIRED', 'JUDGMENT_FAILED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate" ADD "end_reason" ${END_REASON_TYPE}`,
    );

    // 전원 발언으로 끝난 토론(DEBATE_FINALIZED 이후 단계)은 사유가 하나뿐이다.
    await queryRunner.query(
      `UPDATE "debate" SET "end_reason" = 'ALL_TURNS_FINALIZED'
       WHERE "debate_status" IN ('DEBATE_FINALIZED', 'JUDGING', 'COMPLETED')`,
    );
    // 판정 실패는 승자를 기록하지 않으므로, 승자가 있는 FAILED는 기권뿐이다.
    await queryRunner.query(
      `UPDATE "debate" SET "end_reason" = CASE WHEN "winner_id" IS NOT NULL
         THEN 'FORFEIT'::${END_REASON_TYPE} ELSE 'JUDGMENT_FAILED'::${END_REASON_TYPE} END
       WHERE "debate_status" = 'FAILED'`,
    );

    // 종료 경로가 커뮤니티를 되돌리지 않던 시기에 어긋난 운영 데이터를 정리한다.
    await queryRunner.query(
      `UPDATE "community" SET "state" = 'WAITING'
       WHERE "state" = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM "debate"
           WHERE "debate"."community_id" = "community"."id"
             AND "debate"."status" = 'NORMAL'
             AND "debate"."debate_status" IN (${ACTIVE_DEBATE_STATUSES})
         )`,
    );
  }

  /**
   * 커뮤니티 상태 정리(백필)는 되돌리지 않는다 — 어긋난 값으로 되돌릴 이유가 없고 원래 값도 남아 있지 않다.
   *
   * member_id를 다시 NOT NULL로 만들려면 작성자가 없는 시스템 메시지를 먼저 지워야 한다.
   * 남겨 두면 SET NOT NULL이 실패하므로, 되돌리기는 시스템 메시지 삭제를 감수한다.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "debate" DROP COLUMN "end_reason"`);
    await queryRunner.query(`DROP TYPE ${END_REASON_TYPE}`);

    await queryRunner.query(
      `DELETE FROM "community_message" WHERE "member_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "member_id" SET NOT NULL`,
    );
  }
}
