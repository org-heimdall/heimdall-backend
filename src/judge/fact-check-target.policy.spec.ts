import { hashClaim, normalizeClaim } from './claim-normalizer';
import {
  FactCheckCandidate,
  FactCheckTargetPolicy,
} from './fact-check-target.policy';
import { ClaimType, FactCheckExclusionReason } from './judge.types';

describe('FactCheckTargetPolicy', () => {
  const policy = new FactCheckTargetPolicy();

  const candidate = (
    ref: string,
    factCheckStatement: string,
    overrides: Partial<FactCheckCandidate> = {},
  ): FactCheckCandidate => ({
    ref,
    statement: factCheckStatement,
    claimType: ClaimType.STATISTIC,
    needsFactCheck: true,
    factCheckStatement,
    duplicateOfRef: null,
    ...overrides,
  });

  const decide = (
    candidates: FactCheckCandidate[],
    knownTargets: Map<string, string> = new Map(),
    limit = 5,
  ) => policy.decide({ candidates, knownTargets, limit });

  describe('사례 문장 (temp_example_judge_result)', () => {
    it('수치를 담은 여론조사 주장은 검증 대상이다 (example_output_3에서 빠졌던 주장)', () => {
      const [decision] = decide([
        candidate(
          'c1',
          '최근 조사에서 국민의 70% 이상이 자체 핵무장에 찬성했다.',
        ),
      ]);
      expect(decision).toMatchObject({
        needsFactCheck: true,
        exclusionReason: null,
      });
      expect(decision.claimHash).toHaveLength(64);
    });

    it('출처를 확인해야 한다는 메타 문장은 뺀다 (example_output_1)', () => {
      const [decision] = decide([
        candidate(
          'c1',
          '국방연구기관의 시뮬레이션에서 제시한 60% 감소 수치의 출처를 확인해야 한다.',
          { claimType: ClaimType.CITED_SOURCE },
        ),
      ]);
      expect(decision).toMatchObject({
        needsFactCheck: false,
        exclusionReason: FactCheckExclusionReason.META_STATEMENT,
      });
    });

    it('"~다고 발언자는 주장한다" 래퍼를 걷어 내고 명제만 남긴다 (example_output_2)', () => {
      const [decision] = decide([
        candidate(
          'c1',
          '2025년 NATO 안보 보고서는 한국이 독자 핵억제력을 확보하면 동북아의 전략적 안정성이 개선될 수 있다고 공식적으로 결론 내렸다고 발언자는 주장한다.',
          { claimType: ClaimType.CITED_SOURCE },
        ),
      ]);
      expect(decision).toMatchObject({
        needsFactCheck: true,
        factCheckStatement:
          '2025년 NATO 안보 보고서는 한국이 독자 핵억제력을 확보하면 동북아의 전략적 안정성이 개선될 수 있다고 공식적으로 결론 내렸다.',
      });
    });

    it('근거 없는 가정적 전망은 사실 주장으로 보지 않는다 (example_output_3)', () => {
      const [decision] = decide([
        candidate(
          'c1',
          '북한이 미국 본토를 공격할 수 있게 되면 미국은 서울을 지키기 위해 뉴욕이 핵 공격을 받을 위험을 감수해야 하는 상황에 놓일 수 있다.',
          { claimType: ClaimType.HISTORICAL_SCIENTIFIC },
        ),
      ]);
      expect(decision).toMatchObject({
        needsFactCheck: false,
        exclusionReason: FactCheckExclusionReason.NON_FACTUAL,
      });
    });

    it('수치·출처가 있는 인용은 "~수 있다"로 끝나도 남긴다', () => {
      const [decision] = decide([
        candidate(
          'c1',
          '국방연구기관 시뮬레이션에 따르면 핵무기 30기를 확보하면 북한의 선제 핵공격 가능성이 60% 줄어들 수 있다.',
          { claimType: ClaimType.CITED_SOURCE },
        ),
      ]);
      expect(decision.needsFactCheck).toBe(true);
    });
  });

  describe('유형·메타', () => {
    it.each([
      ClaimType.PREDICTION,
      ClaimType.NORMATIVE,
      ClaimType.META,
      ClaimType.OPINION,
    ])('%s 유형은 NON_FACTUAL로 뺀다', (claimType) => {
      const [decision] = decide([
        candidate('c1', '한국은 2023년 워싱턴 선언에 서명했다.', { claimType }),
      ]);
      expect(decision.exclusionReason).toBe(
        FactCheckExclusionReason.NON_FACTUAL,
      );
    });

    it('참여자 표기가 남은 명제는 메타 문장으로 본다', () => {
      const [decision] = decide([
        candidate('c1', 'SIDE_A가 인용한 2024년 조사에서 찬성률은 70%였다.'),
      ]);
      expect(decision.exclusionReason).toBe(
        FactCheckExclusionReason.META_STATEMENT,
      );
    });

    it('검증 명제가 비어 있으면 논증 문장으로 대신 판정한다', () => {
      const [decision] = decide([
        candidate('c1', '', {
          statement: '2023년 한미는 워싱턴 선언을 채택했다.',
          factCheckStatement: null,
          claimType: ClaimType.DATE_EVENT,
        }),
      ]);
      expect(decision).toMatchObject({
        needsFactCheck: true,
        factCheckStatement: '2023년 한미는 워싱턴 선언을 채택했다.',
      });
    });

    it('LLM이 검증을 요청하지 않은 컴포넌트는 판정하지 않고 사유도 남기지 않는다', () => {
      const [decision] = decide([
        candidate('c1', '핵무장은 바람직하다.', { needsFactCheck: false }),
      ]);
      expect(decision).toEqual({
        ref: 'c1',
        needsFactCheck: false,
        factCheckStatement: null,
        claimHash: null,
        exclusionReason: null,
        duplicateOfRef: null,
      });
    });
  });

  describe('중복', () => {
    const CLAIM = '최근 조사에서 국민의 70% 이상이 자체 핵무장에 찬성했다.';

    it('표기만 다른 같은 주장은 이번 분석 안에서 한 번만 검증한다', () => {
      const decisions = decide([
        candidate('c1', CLAIM),
        candidate(
          'c2',
          '최근 조사에서  국민의 70% 이상이 자체 핵무장에 찬성했다',
        ),
      ]);
      expect(decisions[0].needsFactCheck).toBe(true);
      expect(decisions[1]).toMatchObject({
        needsFactCheck: false,
        exclusionReason: FactCheckExclusionReason.DUPLICATE,
        duplicateOfRef: 'c1',
      });
    });

    it('이전 분석에서 검증 대상이 된 주장과 hash가 같으면 그 ref를 가리킨다', () => {
      const [decision] = decide(
        [candidate('c1', CLAIM)],
        new Map([['p3', hashClaim(CLAIM)]]),
      );
      expect(decision).toMatchObject({
        exclusionReason: FactCheckExclusionReason.DUPLICATE,
        duplicateOfRef: 'p3',
      });
    });

    it('LLM이 가리킨 이전 대상(duplicate_of_ref)을 믿는다', () => {
      const [decision] = decide(
        [
          candidate(
            'c1',
            '국민 다수가 자체 핵무장을 지지한다는 조사 결과가 있다.',
            { duplicateOfRef: 'p1' },
          ),
        ],
        new Map([['p1', hashClaim(CLAIM)]]),
      );
      expect(decision).toMatchObject({
        exclusionReason: FactCheckExclusionReason.DUPLICATE,
        duplicateOfRef: 'p1',
      });
    });

    it('존재하지 않는 ref를 가리키면 무시하고 hash로만 판단한다', () => {
      const [decision] = decide([
        candidate('c1', CLAIM, { duplicateOfRef: 'p99' }),
      ]);
      expect(decision).toMatchObject({
        needsFactCheck: true,
        duplicateOfRef: null,
      });
    });
  });

  describe('우선순위 상한', () => {
    it('수치·출처 주장을 먼저 남기고 넘친 것은 OVER_LIMIT으로 뺀다', () => {
      const decisions = decide(
        [
          candidate('c1', '1950년 한국전쟁이 일어났다.', {
            claimType: ClaimType.HISTORICAL_SCIENTIFIC,
          }),
          candidate('c2', '2023년 핵협의그룹이 출범했다.', {
            claimType: ClaimType.DATE_EVENT,
          }),
          candidate('c3', '국민의 70%가 찬성했다.'),
        ],
        new Map(),
        2,
      );

      expect(decisions.map((decision) => decision.needsFactCheck)).toEqual([
        false,
        true,
        true,
      ]);
      expect(decisions[0].exclusionReason).toBe(
        FactCheckExclusionReason.OVER_LIMIT,
      );
    });
  });

  describe('normalizeClaim', () => {
    it('공백·문장부호·전각 문자·대소문자 차이를 없앤다', () => {
      expect(normalizeClaim('NATO는  2025년, 보고서를 냈다.')).toBe(
        normalizeClaim('ｎａｔｏ는 2025년 보고서를 냈다'),
      );
    });
  });
});
