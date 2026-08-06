import { QueryFailedError } from 'typeorm';

/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

/** pg 드라이버가 unique 위반 시 채워주는 필드(code=SQLSTATE, constraint=제약 이름) */
interface PgDriverError {
  code?: string;
  constraint?: string;
}

// unique 위반이면 위반된 제약 이름을, 아니면 null을 반환한다.
// SQLSTATE만으로는 어느 제약이 터졌는지 알 수 없으므로, 도메인은 이 이름으로 에러를 분류한다.
// 제약 이름을 얻지 못한 경우(드라이버가 채우지 않음)에도 분류할 수 없으므로 null을 반환한다.
export function getUniqueViolationConstraint(error: unknown): string | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }

  const driverError = error.driverError as PgDriverError | undefined;

  if (driverError?.code !== PG_UNIQUE_VIOLATION) {
    return null;
  }

  return driverError.constraint ?? null;
}
