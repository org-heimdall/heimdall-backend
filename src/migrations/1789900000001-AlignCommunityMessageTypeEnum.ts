import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * community_message.message_type을 계약의 값 집합으로 맞춘다.
 *
 * 바뀌는 것은 두 가지다. (1) 기존 세 값의 표기를 계약의 다른 열거형과 같은 SCREAMING_SNAKE_CASE로
 * 바꾸고, (2) 프론트가 따로 렌더링하는 토론 알림 네 값을 추가한다.
 *
 * ADD VALUE로 붙이지 않고 타입을 새로 만드는 이유: 기존 값의 이름까지 바뀌어 어차피 USING으로
 * 다시 쓰기 때문이고, 그래야 열거형 순서도 계약 순서대로 남는다.
 */
const OLD_TO_NEW: ReadonlyArray<readonly [string, string]> = [
  ['text', 'TEXT'],
  ['system', 'SYSTEM'],
  ['opinionNotice', 'OPINION_NOTICE'],
];

const NEW_VALUES = [
  'TEXT',
  'SYSTEM',
  'OPINION_NOTICE',
  'DEBATE_STARTED',
  'DEBATE_RESULT',
  'DEBATE_FORFEIT',
  'DEBATE_TIMEOUT',
];

const TYPE = '"public"."community_message_message_type_enum"';
const OLD_TYPE = '"public"."community_message_message_type_enum_old"';
// ALTER TYPE ... RENAME TO의 새 이름은 스키마로 수식할 수 없다(수식하면 구문 오류다).
// 타입은 원래 스키마에 그대로 남으므로 이름만 준다.
const OLD_TYPE_NAME = '"community_message_message_type_enum_old"';

// CASE 식으로 옛 값 → 새 값 변환을 만든다. 매핑에 없는 값은 NULL이 되어 NOT NULL 제약이 잡아낸다.
function castExpression(
  map: ReadonlyArray<readonly [string, string]>,
  targetType: string,
): string {
  const branches = map
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
    .join(' ');
  return `(CASE "message_type"::text ${branches} END)::${targetType}`;
}

export class AlignCommunityMessageTypeEnum1789900000001 implements MigrationInterface {
  name = 'AlignCommunityMessageTypeEnum1789900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE ${TYPE} RENAME TO ${OLD_TYPE_NAME}`);
    await queryRunner.query(
      `CREATE TYPE ${TYPE} AS ENUM(${NEW_VALUES.map((value) => `'${value}'`).join(', ')})`,
    );
    // 기본값이 옛 타입에 묶여 있어 타입을 바꾸기 전에 떼어내야 한다.
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "message_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "message_type" TYPE ${TYPE} USING ${castExpression(OLD_TO_NEW, TYPE)}`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "message_type" SET DEFAULT 'TEXT'`,
    );
    await queryRunner.query(`DROP TYPE ${OLD_TYPE}`);
  }

  /**
   * 되돌리면 추가한 네 값이 사라지므로, 그 값을 쓰는 행이 있으면 변환에서 NULL이 되어 실패한다.
   * 아직 아무도 만들지 않는 값이라 실제로는 걸리지 않지만, 조용히 다른 값으로 뭉개지 않게 둔다.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const reverted = OLD_TO_NEW.map(
      ([from, to]) => [to, from] as readonly [string, string],
    );

    await queryRunner.query(`ALTER TYPE ${TYPE} RENAME TO ${OLD_TYPE_NAME}`);
    await queryRunner.query(
      `CREATE TYPE ${TYPE} AS ENUM('text', 'system', 'opinionNotice')`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "message_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "message_type" TYPE ${TYPE} USING ${castExpression(reverted, TYPE)}`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_message" ALTER COLUMN "message_type" SET DEFAULT 'text'`,
    );
    await queryRunner.query(`DROP TYPE ${OLD_TYPE}`);
  }
}
