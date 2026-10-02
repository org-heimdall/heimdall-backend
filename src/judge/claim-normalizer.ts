import { createHash } from 'node:crypto';

/**
 * 검증 명제를 비교용으로 정규화한다. 표기만 다른 같은 주장(공백·문장부호·전각 문자·대소문자 차이)을 같은 값으로 모은다.
 * 의미가 같지만 표현이 다른 주장은 여기서 잡지 않는다 — 그것은 Analyzer의 duplicate_of_ref가 맡는다.
 */
export function normalizeClaim(statement: string): string {
  return statement
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '');
}

// 정규화한 명제의 sha256 hex. 컴포넌트의 claim_hash 컬럼 값이다.
export function hashClaim(statement: string): string {
  return createHash('sha256').update(normalizeClaim(statement)).digest('hex');
}
