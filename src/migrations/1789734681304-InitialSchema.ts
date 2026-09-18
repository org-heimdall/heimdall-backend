import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1789734681304 implements MigrationInterface {
  name = 'InitialSchema1789734681304';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b575dd3c21fb0831013c909e7fe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a5660d57515144c9f2bee5ac46" ON "refresh_token"  ("member_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f0812282fad2e352cdaf83ef0a" ON "refresh_token"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."member_status_enum" AS ENUM('NORMAL', 'DELETED', 'ADMIN_DELETED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "member" ("status" "public"."member_status_enum" NOT NULL DEFAULT 'NORMAL', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying, "password" character varying, "nickname" character varying NOT NULL, "gender" character varying, "age" integer, "profile_image_url" character varying, "social_credit" double precision NOT NULL DEFAULT '100', "rating" double precision NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_member_email" UNIQUE ("email"), CONSTRAINT "PK_97cbbe986ce9d14ca5894fdc072" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "theme" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, CONSTRAINT "PK_c1934d0b4403bf10c1ab0c18166" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."community_status_enum" AS ENUM('NORMAL', 'DELETED', 'ADMIN_DELETED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."community_state_enum" AS ENUM('WAITING', 'ACTIVE', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "community" ("status" "public"."community_status_enum" NOT NULL DEFAULT 'NORMAL', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "theme_id" uuid NOT NULL, "state" "public"."community_state_enum" NOT NULL, "title" character varying NOT NULL, "is_public" boolean NOT NULL DEFAULT true, "host_id" uuid NOT NULL, "member_count" integer NOT NULL, "topic" character varying NOT NULL, "debate_round_count" integer NOT NULL, "community_link" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cae794115a383328e8923de4193" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "community_favorite" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "community_id" uuid NOT NULL, "is_favored" boolean NOT NULL, CONSTRAINT "UQ_ab281ab91d9c2d833e1544e3245" UNIQUE ("member_id", "community_id"), CONSTRAINT "PK_c90e413422c75f5dc2d53135036" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."community_message_status_enum" AS ENUM('NORMAL', 'DELETED', 'ADMIN_DELETED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."community_message_message_type_enum" AS ENUM('text', 'system', 'opinionNotice')`,
    );
    await queryRunner.query(
      `CREATE TABLE "community_message" ("status" "public"."community_message_status_enum" NOT NULL DEFAULT 'NORMAL', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "community_id" uuid NOT NULL, "body" character varying, "client_message_id" character varying NOT NULL, "message_type" "public"."community_message_message_type_enum" NOT NULL DEFAULT 'text', "debate_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_community_message_client" UNIQUE ("community_id", "client_message_id"), CONSTRAINT "PK_163aa15b53779c00f20503ddb3c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_invitation_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_invitation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "community_id" uuid NOT NULL, "host_member_id" uuid NOT NULL, "opponent_member_id" uuid NOT NULL, "status" "public"."debate_invitation_status_enum" NOT NULL DEFAULT 'PENDING', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "responded_at" TIMESTAMP WITH TIME ZONE, "debate_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_99d1c8227b35b021d72f6889075" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_debate_invitation_pending" ON "debate_invitation"  ("community_id") WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_status_enum" AS ENUM('NORMAL', 'DELETED', 'ADMIN_DELETED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_current_turn_enum" AS ENUM('HOST', 'OPPONENT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_debate_status_enum" AS ENUM('READY', 'IN_PROGRESS', 'DEBATE_FINALIZED', 'JUDGING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate" ("status" "public"."debate_status_enum" NOT NULL DEFAULT 'NORMAL', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "community_id" uuid NOT NULL, "topic" character varying(500) NOT NULL, "rebuttal_question_rounds" integer NOT NULL, "host_id" uuid NOT NULL, "host_nickname" character varying NOT NULL, "opponent_id" uuid, "opponent_nickname" character varying, "current_turn" "public"."debate_current_turn_enum" NOT NULL, "debate_status" "public"."debate_debate_status_enum", "started_at" TIMESTAMP WITH TIME ZONE, "ended_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "judging_started_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "winner_id" uuid, CONSTRAINT "PK_b4dfdc0b06c019e20e85570158f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_message_status_enum" AS ENUM('NORMAL', 'DELETED', 'ADMIN_DELETED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_message" ("status" "public"."debate_message_status_enum" NOT NULL DEFAULT 'NORMAL', "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "debate_id" uuid NOT NULL, "body" text, "remaining_images_count" integer, "image_url" text, "sequence" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_33546fa37b32fece56b1d4e6899" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8ee80d82eb07ea9360608adfb5" ON "debate_message"  ("debate_id", "sequence") `,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_message_like" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "message_id" uuid NOT NULL, "is_liked" boolean NOT NULL, CONSTRAINT "UQ_cc0a50e1727f9cfd14cd9e23b77" UNIQUE ("member_id", "message_id"), CONSTRAINT "PK_c8a73ea4e574635c8234101e351" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_argument_component_speaker_side_enum" AS ENUM('SIDE_A', 'SIDE_B')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_argument_component_kind_enum" AS ENUM('CLAIM', 'EVIDENCE', 'QUESTION', 'REBUTTAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_argument_component" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "debate_id" uuid NOT NULL, "turn_id" uuid NOT NULL, "turn_sequence" integer NOT NULL, "speaker_id" uuid NOT NULL, "speaker_side" "public"."debate_argument_component_speaker_side_enum" NOT NULL, "kind" "public"."debate_argument_component_kind_enum" NOT NULL, "statement" text NOT NULL, "needs_fact_check" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f3b7d6acdd2b75dae8ab889a31e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e35d5c081aba4fedbe14cd198a" ON "debate_argument_component"  ("debate_id", "turn_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_argument_relation_kind_enum" AS ENUM('SUPPORT', 'ATTACK', 'QUESTION')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_argument_relation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "debate_id" uuid NOT NULL, "from_component_id" uuid NOT NULL, "to_component_id" uuid NOT NULL, "kind" "public"."debate_argument_relation_kind_enum" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3acb62a48b72e88604f6edf93ba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_269042f299c33759a229e53c58" ON "debate_argument_relation"  ("debate_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_fact_check_result_status_enum" AS ENUM('SUPPORTED', 'CONTRADICTED', 'PARTIALLY_SUPPORTED', 'INSUFFICIENT_EVIDENCE', 'NOT_VERIFIABLE', 'OUTDATED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_fact_check_result" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "debate_id" uuid NOT NULL, "component_id" uuid NOT NULL, "status" "public"."debate_fact_check_result_status_enum" NOT NULL, "reason" text NOT NULL, "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "sources" jsonb NOT NULL DEFAULT '[]'::jsonb, CONSTRAINT "UQ_3d76974088a16840a18c76c2823" UNIQUE ("component_id"), CONSTRAINT "PK_f3ff58a1c3cc6744bd7885d373e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7ca580033acd355d3e29f8493" ON "debate_fact_check_result"  ("debate_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_judgment_result_winner_enum" AS ENUM('SIDE_A', 'SIDE_B', 'DRAW')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_judgment_result" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "debate_id" uuid NOT NULL, "winner" "public"."debate_judgment_result_winner_enum" NOT NULL, "side_a_argumentation_score" integer NOT NULL, "side_a_interaction_score" integer NOT NULL, "side_a_factual_reliability_score" integer NOT NULL, "side_a_total_score" integer NOT NULL, "side_b_argumentation_score" integer NOT NULL, "side_b_interaction_score" integer NOT NULL, "side_b_factual_reliability_score" integer NOT NULL, "side_b_total_score" integer NOT NULL, "overall_reason" text NOT NULL, "side_a_feedback" text NOT NULL, "side_b_feedback" text NOT NULL, "side_a_violations" jsonb NOT NULL DEFAULT '[]'::jsonb, "side_b_violations" jsonb NOT NULL DEFAULT '[]'::jsonb, "side_a_social_credit_penalty" integer NOT NULL DEFAULT '0', "side_b_social_credit_penalty" integer NOT NULL DEFAULT '0', "model" character varying(100) NOT NULL, "judged_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_55110b4a3c4aca4585a94140d81" UNIQUE ("debate_id"), CONSTRAINT "PK_e4872ae83f0131c32a6fafcb043" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."member_community_debate_intent_enum" AS ENUM('OPEN_TO_DEBATE', 'PREPARING')`,
    );
    await queryRunner.query(
      `CREATE TABLE "member_community" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "community_id" uuid NOT NULL, "is_online" boolean NOT NULL DEFAULT false, "debate_intent" "public"."member_community_debate_intent_enum" NOT NULL DEFAULT 'PREPARING', "opinion" character varying, "reasons" text array, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9e64759115f59a5ebff0454d610" UNIQUE ("member_id", "community_id"), CONSTRAINT "PK_98d855e7c3880f24f3b6e87058f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_judge_task_kind_enum" AS ENUM('ANALYZER', 'FACT_CHECK', 'JUDGE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."debate_judge_task_status_enum" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "debate_judge_task" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "debate_id" uuid NOT NULL, "kind" "public"."debate_judge_task_kind_enum" NOT NULL, "target_id" uuid NOT NULL, "status" "public"."debate_judge_task_status_enum" NOT NULL DEFAULT 'PENDING', "attempt" integer NOT NULL DEFAULT '0', "max_attempts" integer NOT NULL, "request_id" uuid, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4a4281cbaa858534038b8b1e6fc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97126bfdc4631a3978ebef01a9" ON "debate_judge_task"  ("debate_id", "kind", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_12637f1fd0c5ad55c83b165ddf" ON "debate_judge_task"  ("kind", "target_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."member_oauth_account_provider_enum" AS ENUM('GOOGLE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "member_oauth_account" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "provider" "public"."member_oauth_account_provider_enum" NOT NULL, "provider_id" character varying NOT NULL, "email" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fd545effd1a69d19bc83fd3b803" UNIQUE ("provider", "provider_id"), CONSTRAINT "PK_450ec86f4717825e20ad269bc34" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "community" ADD CONSTRAINT "FK_39ed6f690096855811b1fec6f92" FOREIGN KEY ("theme_id") REFERENCES "theme"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_favorite" ADD CONSTRAINT "FK_a25c8f94c997d566a5ebfff5406" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_favorite" ADD CONSTRAINT "FK_5758268e2378d4d4b276cc29519" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ADD CONSTRAINT "FK_4979117400a8a652f602941ca17" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ADD CONSTRAINT "FK_b309218a4f607637e9ea338f005" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate" ADD CONSTRAINT "FK_e61bddb10a59a06aee2d9f4cd41" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message" ADD CONSTRAINT "FK_698d863ec407e172ece2ff5286b" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message" ADD CONSTRAINT "FK_483670d5ebd4f155ef8d234aecd" FOREIGN KEY ("debate_id") REFERENCES "debate"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message_like" ADD CONSTRAINT "FK_5ada5cc9f0e5176f6ddb93e37ce" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message_like" ADD CONSTRAINT "FK_18bfbe4e3abba951d52206e56d4" FOREIGN KEY ("message_id") REFERENCES "debate_message"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_fact_check_result" ADD CONSTRAINT "FK_3d76974088a16840a18c76c2823" FOREIGN KEY ("component_id") REFERENCES "debate_argument_component"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_community" ADD CONSTRAINT "FK_b253b0d9a1d00dc364f14e5ccb2" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_community" ADD CONSTRAINT "FK_28fa499e4182619ab59293731ab" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_oauth_account" ADD CONSTRAINT "FK_c5d45f4a41bbea698d6921db2ce" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "member_oauth_account" DROP CONSTRAINT "FK_c5d45f4a41bbea698d6921db2ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_community" DROP CONSTRAINT "FK_28fa499e4182619ab59293731ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_community" DROP CONSTRAINT "FK_b253b0d9a1d00dc364f14e5ccb2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_fact_check_result" DROP CONSTRAINT "FK_3d76974088a16840a18c76c2823"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message_like" DROP CONSTRAINT "FK_18bfbe4e3abba951d52206e56d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message_like" DROP CONSTRAINT "FK_5ada5cc9f0e5176f6ddb93e37ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message" DROP CONSTRAINT "FK_483670d5ebd4f155ef8d234aecd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate_message" DROP CONSTRAINT "FK_698d863ec407e172ece2ff5286b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debate" DROP CONSTRAINT "FK_e61bddb10a59a06aee2d9f4cd41"`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" DROP CONSTRAINT "FK_b309218a4f607637e9ea338f005"`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" DROP CONSTRAINT "FK_4979117400a8a652f602941ca17"`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_favorite" DROP CONSTRAINT "FK_5758268e2378d4d4b276cc29519"`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_favorite" DROP CONSTRAINT "FK_a25c8f94c997d566a5ebfff5406"`,
    );
    await queryRunner.query(
      `ALTER TABLE "community" DROP CONSTRAINT "FK_39ed6f690096855811b1fec6f92"`,
    );
    await queryRunner.query(`DROP TABLE "member_oauth_account"`);
    await queryRunner.query(
      `DROP TYPE "public"."member_oauth_account_provider_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12637f1fd0c5ad55c83b165ddf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97126bfdc4631a3978ebef01a9"`,
    );
    await queryRunner.query(`DROP TABLE "debate_judge_task"`);
    await queryRunner.query(
      `DROP TYPE "public"."debate_judge_task_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."debate_judge_task_kind_enum"`);
    await queryRunner.query(`DROP TABLE "member_community"`);
    await queryRunner.query(
      `DROP TYPE "public"."member_community_debate_intent_enum"`,
    );
    await queryRunner.query(`DROP TABLE "debate_judgment_result"`);
    await queryRunner.query(
      `DROP TYPE "public"."debate_judgment_result_winner_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7ca580033acd355d3e29f8493"`,
    );
    await queryRunner.query(`DROP TABLE "debate_fact_check_result"`);
    await queryRunner.query(
      `DROP TYPE "public"."debate_fact_check_result_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_269042f299c33759a229e53c58"`,
    );
    await queryRunner.query(`DROP TABLE "debate_argument_relation"`);
    await queryRunner.query(
      `DROP TYPE "public"."debate_argument_relation_kind_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e35d5c081aba4fedbe14cd198a"`,
    );
    await queryRunner.query(`DROP TABLE "debate_argument_component"`);
    await queryRunner.query(
      `DROP TYPE "public"."debate_argument_component_kind_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."debate_argument_component_speaker_side_enum"`,
    );
    await queryRunner.query(`DROP TABLE "debate_message_like"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ee80d82eb07ea9360608adfb5"`,
    );
    await queryRunner.query(`DROP TABLE "debate_message"`);
    await queryRunner.query(`DROP TYPE "public"."debate_message_status_enum"`);
    await queryRunner.query(`DROP TABLE "debate"`);
    await queryRunner.query(`DROP TYPE "public"."debate_debate_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."debate_current_turn_enum"`);
    await queryRunner.query(`DROP TYPE "public"."debate_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_debate_invitation_pending"`,
    );
    await queryRunner.query(`DROP TABLE "debate_invitation"`);
    await queryRunner.query(
      `DROP TYPE "public"."debate_invitation_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "community_message"`);
    await queryRunner.query(
      `DROP TYPE "public"."community_message_message_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."community_message_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "community_favorite"`);
    await queryRunner.query(`DROP TABLE "community"`);
    await queryRunner.query(`DROP TYPE "public"."community_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."community_status_enum"`);
    await queryRunner.query(`DROP TABLE "theme"`);
    await queryRunner.query(`DROP TABLE "member"`);
    await queryRunner.query(`DROP TYPE "public"."member_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0812282fad2e352cdaf83ef0a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a5660d57515144c9f2bee5ac46"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_token"`);
  }
}
