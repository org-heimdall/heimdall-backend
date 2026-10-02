import { Injectable } from '@nestjs/common';
import { hashClaim } from './claim-normalizer';
import { ClaimType, FactCheckExclusionReason } from './judge.types';
import { canonicalizeSideTokens } from './judgment-text';

// 외부 자료로 검증할 수 있는 주장 유형과 우선순위(작을수록 먼저). 수치·출처 주장을 가장 먼저 검증한다.
const VERIFIABLE_PRIORITY: Partial<Record<ClaimType, number>> = {
  [ClaimType.STATISTIC]: 0,
  [ClaimType.CITED_SOURCE]: 0,
  [ClaimType.DATE_EVENT]: 1,
  [ClaimType.LAW_INSTITUTION]: 1,
  [ClaimType.HISTORICAL_SCIENTIFIC]: 2,
};

// "…다고 발언자는 주장한다." 같은 발언자 래퍼. 명제 부분("…다")만 남기고 걷어 낸다.
const SPEAKER_WRAPPER =
  /(다)고\s*(?:(?:발언자|화자|상대방?|상대\s?측|그)(?:는|은|이|가)?\s*)?(?:주장|언급|말|발언|강조|설명)(?:한다|했다|하였다|하고\s?있다)\.?$/u;

// 래퍼를 걷어 낸 뒤에도 남아 있으면 검증할 명제가 아니라 발언·논증에 대한 메타 문장이다.
const META_PATTERNS: readonly RegExp[] = [
  /발언자|화자/u,
  /상대(?:방|\s?측)?(?:은|는|의\s?주장)/u,
  /확인(?:해야|이\s?필요|할\s?필요)/u,
  /출처를\s?(?:밝혀|확인|제시)/u,
  /라고\s?(?:본다|생각한다|주장한다|주장했다)/u,
];

// 예측·가정·규범으로 끝나는 문장. 검증 앵커가 없으면 사실 주장으로 보지 않는다.
const SPECULATIVE_ENDING =
  /(?:해야\s?한다|바람직하다|수도?\s?있다|것이다|것으로\s?보인다|가능성이\s?(?:있다|크다|높다))\.?$/u;

// 외부 자료로 확인할 근거가 문장 안에 있다는 표지(수치·연도·조항·법·조사·보고서·기관 등).
const VERIFIABLE_ANCHOR =
  /\d|퍼센트|제\s?\d+\s?조|법률|조약|협정|결의안?|선언|보고서|조사|연구|통계|여론|시뮬레이션|발표|NATO|UN|유엔|IAEA/iu;

// 분석 결과 컴포넌트 하나에 대한 판정 입력.
export interface FactCheckCandidate {
  ref: string;
  statement: string;
  claimType: ClaimType;
  // LLM이 검증을 요청했는지. false면 정책은 판정하지 않는다.
  needsFactCheck: boolean;
  factCheckStatement: string | null;
  duplicateOfRef: string | null;
}

export interface FactCheckDecision {
  ref: string;
  needsFactCheck: boolean;
  // 정리된 검증 명제. LLM이 검증을 요청하지 않은 컴포넌트는 null.
  factCheckStatement: string | null;
  claimHash: string | null;
  exclusionReason: FactCheckExclusionReason | null;
  // 같은 주장을 먼저 한 컴포넌트의 ref(이전 분석의 p… 또는 이번 분석의 c…).
  duplicateOfRef: string | null;
}

export interface FactCheckPolicyInput {
  // 발언 순서대로의 후보.
  candidates: FactCheckCandidate[];
  // 이미 검증 대상이 된 이전 컴포넌트: ref → claimHash.
  knownTargets: ReadonlyMap<string, string>;
  // 이번 분석에서 검증 대상으로 남길 최대 개수.
  limit: number;
}

/**
 * 사실 검증 대상의 최종 선별. LLM의 needs_fact_check·claim_type은 후보 신호일 뿐이고,
 * 무엇을 검증할지는 여기서 결정한다 — 같은 입력에는 늘 같은 결정이 나와야 튜닝·감사가 가능하다.
 *
 * 순서: 명제 정리 → 유형 → 메타 표현 → 예측·규범 어미 → 중복 → 우선순위 상한.
 * 뺀 후보는 이유를 남기고, 결정은 후보와 같은 순서로 돌려준다.
 */
@Injectable()
export class FactCheckTargetPolicy {
  decide(input: FactCheckPolicyInput): FactCheckDecision[] {
    const decisions = input.candidates.map((candidate) =>
      this.screen(candidate),
    );
    this.markDuplicates(input.candidates, decisions, input.knownTargets);
    this.applyLimit(input.candidates, decisions, input.limit);
    return decisions;
  }

  // 후보 하나만 보고 내릴 수 있는 판정(정리·유형·메타·어미).
  private screen(candidate: FactCheckCandidate): FactCheckDecision {
    if (!candidate.needsFactCheck) {
      return {
        ref: candidate.ref,
        needsFactCheck: false,
        factCheckStatement: null,
        claimHash: null,
        exclusionReason: null,
        duplicateOfRef: null,
      };
    }

    const statement = cleanStatement(
      candidate.factCheckStatement?.trim() || candidate.statement,
    );
    const excluded = (reason: FactCheckExclusionReason): FactCheckDecision => ({
      ref: candidate.ref,
      needsFactCheck: false,
      factCheckStatement: statement,
      claimHash: hashClaim(statement),
      exclusionReason: reason,
      duplicateOfRef: null,
    });

    if (VERIFIABLE_PRIORITY[candidate.claimType] === undefined) {
      return excluded(FactCheckExclusionReason.NON_FACTUAL);
    }
    if (isMetaStatement(statement)) {
      return excluded(FactCheckExclusionReason.META_STATEMENT);
    }
    if (
      SPECULATIVE_ENDING.test(statement) &&
      !VERIFIABLE_ANCHOR.test(statement)
    ) {
      return excluded(FactCheckExclusionReason.NON_FACTUAL);
    }

    return {
      ref: candidate.ref,
      needsFactCheck: true,
      factCheckStatement: statement,
      claimHash: hashClaim(statement),
      exclusionReason: null,
      duplicateOfRef: null,
    };
  }

  /**
   * 이미 검증 대상인 주장과 같으면 뺀다. LLM이 가리킨 이전 대상(duplicate_of_ref)을 먼저 믿고,
   * 그다음 명제 hash로 이전 대상·이번 분석의 앞선 후보와 비교한다. 존재하지 않는 ref는 무시한다(재시도하지 않는다).
   */
  private markDuplicates(
    candidates: FactCheckCandidate[],
    decisions: FactCheckDecision[],
    knownTargets: ReadonlyMap<string, string>,
  ): void {
    const refByHash = new Map<string, string>();
    for (const [ref, hash] of knownTargets) {
      if (!refByHash.has(hash)) {
        refByHash.set(hash, ref);
      }
    }
    const acceptedRefs = new Set<string>();

    decisions.forEach((decision, index) => {
      if (!decision.needsFactCheck || decision.claimHash === null) {
        return;
      }
      const pointed = candidates[index].duplicateOfRef;
      const originRef =
        pointed !== null &&
        (knownTargets.has(pointed) || acceptedRefs.has(pointed))
          ? pointed
          : (refByHash.get(decision.claimHash) ?? null);

      if (originRef !== null) {
        decision.needsFactCheck = false;
        decision.exclusionReason = FactCheckExclusionReason.DUPLICATE;
        decision.duplicateOfRef = originRef;
        return;
      }
      refByHash.set(decision.claimHash, decision.ref);
      acceptedRefs.add(decision.ref);
    });
  }

  // 남은 대상을 우선순위(유형) → 발언 순서로 세워 상한까지만 남긴다.
  private applyLimit(
    candidates: FactCheckCandidate[],
    decisions: FactCheckDecision[],
    limit: number,
  ): void {
    const ranked = decisions
      .map((decision, index) => ({ decision, index }))
      .filter(({ decision }) => decision.needsFactCheck)
      .sort(
        (left, right) =>
          (VERIFIABLE_PRIORITY[candidates[left.index].claimType] as number) -
            (VERIFIABLE_PRIORITY[
              candidates[right.index].claimType
            ] as number) || left.index - right.index,
      );

    for (const { decision } of ranked.slice(limit)) {
      decision.needsFactCheck = false;
      decision.exclusionReason = FactCheckExclusionReason.OVER_LIMIT;
    }
  }
}

// 발언자 래퍼를 걷어 내고 공백을 정리한다.
function cleanStatement(statement: string): string {
  return statement.trim().replace(/\s+/g, ' ').replace(SPEAKER_WRAPPER, '$1.');
}

// 발언자·메타 표현이나 참여자 표기(SIDE_A, A측 …)가 남아 있는지.
function isMetaStatement(statement: string): boolean {
  return (
    canonicalizeSideTokens(statement) !== statement ||
    statement.includes('{{') ||
    META_PATTERNS.some((pattern) => pattern.test(statement))
  );
}
