import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { DebateRound, DebateTurnSchedule } from '../debates/debate-turn';
import { DebatesService } from '../debates/debates.service';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import {
  JudgeTaskKind,
  FactCheckSource,
  VerificationStatus,
} from './judge.types';
import { REPORT_FIRST_ATTEMPT_START_ONLY } from './judge-stage-reporting';
import { JudgeTaskHandler, NonRetryableTaskError } from './judge-task.worker';
import { JudgeResultRepository } from './judge-result.repository';
import { resolveRound } from './judge-turn-slot';
import { canonicalizeSideTokens } from './judgment-text';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { FACT_CHECKER } from './llm/judge-llm';
import type { FactCheckItemOutcome, FactChecker } from './llm/judge-llm';

/**
 * 출처가 없어도 되는 판정. "확인할 자료를 못 찾았다"는 결론 자체가 출처를 가질 수 없다.
 * 나머지 판정은 무언가를 단정하므로 근거 없이는 저장하지 않는다.
 */
const STATUSES_WITHOUT_SOURCES: readonly VerificationStatus[] = [
  VerificationStatus.INSUFFICIENT_EVIDENCE,
  VerificationStatus.NOT_VERIFIABLE,
];

// 검증 결과 하나에 저장하는 출처 링크 상한. 넘는 것은 거부하지 않고 잘라낸다.
export const MAX_SOURCES = 3;

// 로그 한 줄에 싣는 검증 문장의 길이 상한.
const LOG_STATEMENT_LENGTH = 60;

// batch 안에서 검증 명제를 가리키는 별칭 접두사(f1, f2 …).
const TARGET_REF_PREFIX = 'f';

/**
 * 검증 근거 설명(reason)에 있으면 안 되는 표현. reason은 그 명제의 사실 여부에 대한 근거만 담아야 하고,
 * 토론 평가·승패 조언·발언자 언급이 섞이면 카드가 판정처럼 읽힌다. 재시도를 남발하지 않도록 좁게 둔다.
 */
const FORBIDDEN_REASON_PATTERNS: readonly RegExp[] = [
  /발언자|화자/u,
  /토론에서\s?(?:이기|승리|유리)/u,
  /설득력/u,
  /승패/u,
];

// Source Validator가 거부한 결과. 다시 물으면 달라질 수 있으므로 재시도 대상이다.
export class FactCheckSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactCheckSourceValidationError';
  }
}

// 검증 근거 설명이 명제와 무관한 평가·조언을 담았다. 다시 물으면 달라질 수 있으므로 재시도 대상이다.
export class FactCheckReasonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactCheckReasonValidationError';
  }
}

/**
 * batch 응답에서 일부 명제의 판정이 빠졌거나 검증을 통과하지 못했다. 통과한 판정은 이미 저장했으므로
 * 재시도는 남은 명제만 다시 묻는다.
 */
export class FactCheckBatchIncompleteError extends Error {
  constructor(unresolved: string[], failures: string[]) {
    super(
      `검증 결과를 받지 못한 명제 ${unresolved.length}건: ${unresolved.join(', ')}` +
        (failures.length === 0 ? '' : ` (${failures.join('; ')})`),
    );
    this.name = 'FactCheckBatchIncompleteError';
  }
}

/**
 * 라운드 하나의 사실 검증(bounded batch). 대상(task.targetId)은 라운드를 닫는 확정 턴이며,
 * 그 라운드에서 검증 대상으로 남은 컴포넌트 가운데 아직 결과가 없는 것을 한 번의 호출로 검증한다.
 * 재시도·재실행은 결과가 없는 것만 다시 묻으므로 몇 번 돌아도 결과가 겹치지 않는다.
 *
 * 여기서 최종 실패(FAILED)해도 판정은 막히지 않는다 — 검색이 안 됐다는 이유로 토론 전체가
 * 영영 판정 불가가 되면 안 되기 때문이다. 그 판단은 판정 조건 쪽에 있다.
 *
 * 같은 이유로 프론트에는 첫 시도의 "시작"만 알린다. 재시도·최종 실패는 사용자가 할 수 있는
 * 일이 없는 내부 사정이므로 백엔드 로그에만 남긴다.
 */
@Injectable()
export class FactCheckerService implements JudgeTaskHandler {
  private readonly logger = new Logger(FactCheckerService.name);
  readonly kind = JudgeTaskKind.FACT_CHECK;
  readonly stageReporting = REPORT_FIRST_ATTEMPT_START_ONLY;

  constructor(
    @Inject(FACT_CHECKER)
    private readonly factChecker: FactChecker,
    @InjectRepository(DebateMessage)
    private readonly messages: Repository<DebateMessage>,
    private readonly results: JudgeResultRepository,
    private readonly debates: DebatesService,
  ) {}

  // 검증은 라운드 단위이므로 stage 메시지에 몇 번째 라운드인지 남긴다.
  async describe(task: JudgeTask): Promise<string | null> {
    const anchor = await this.messages.findOneBy({ id: task.targetId });
    if (anchor === null || anchor.sequence === null) {
      return null;
    }
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const round = new DebateTurnSchedule(debate.rebuttalQuestionRounds).roundOf(
      anchor.sequence - 1,
    );
    return round === null ? null : `round #${round.ordinal}`;
  }

  async handle(task: JudgeTask): Promise<void> {
    const anchor = await this.findAnchorOrThrow(task.targetId);
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const round = resolveRound(debate, anchor.sequence as number);
    const roundMessages = await this.findRoundMessages(debate.id, round);

    const targets = await this.results.findUnresolvedTargets(
      debate.id,
      roundMessages.map((message) => message.id),
    );
    if (targets.length === 0) {
      return;
    }
    const targetByRef = new Map(
      targets.map((target, index) => [
        `${TARGET_REF_PREFIX}${index + 1}`,
        target,
      ]),
    );

    const checked = await this.factChecker.checkBatch({
      topic: debate.topic,
      context: roundMessages
        .map((message) => (message.body ?? '').trim())
        .filter((body) => body !== '')
        .join('\n\n'),
      targets: [...targetByRef].map(([ref, target]) => ({
        ref,
        statement: statementOf(target),
        claimType: target.claimType,
      })),
      logContext: {
        stage: 'grounded_check',
        debateId: debate.id,
        phase: round.phase,
        round: round.round,
        targets: targets.map((target) => target.id),
      },
    });

    // 명제마다 따로 검사해 통과한 것은 바로 저장한다. 한 명제가 어긋났다고 나머지를 버리지 않는다.
    const resolved = new Set<string>();
    const failures: string[] = [];
    for (const item of checked.results) {
      const target = targetByRef.get(item.ref);
      if (target === undefined || resolved.has(item.ref)) {
        // 요청하지 않은 ref이거나 같은 ref의 두 번째 답이다. 첫 답만 쓴다.
        continue;
      }
      try {
        this.validateOutcome(item, checked.groundedDomains);
      } catch (error: unknown) {
        failures.push(
          `${item.ref}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      const sources = limitSources(item.sources, checked.groundedDomains);
      this.logOutcome(target, item, sources, checked.groundedDomains);
      await this.results.replaceFactCheck({
        debateId: debate.id,
        componentId: target.id,
        status: item.status,
        reason: item.reason.trim(),
        sources,
      });
      resolved.add(item.ref);
    }

    const unresolved = [...targetByRef.keys()].filter(
      (ref) => !resolved.has(ref),
    );
    if (unresolved.length > 0) {
      throw new FactCheckBatchIncompleteError(unresolved, failures);
    }
  }

  /**
   * 검증 결과를 로그로 남긴다. 판정 한 줄은 log, 근거·출처·검색 도메인은 debug다.
   * 검증 문장은 분석 단계가 이미 전문을 남겼으므로 여기서는 줄여 싣는다.
   * 출처가 상한으로 잘렸으면 원래 건수를 함께 남긴다.
   */
  private logOutcome(
    component: DebateArgumentComponent,
    outcome: FactCheckItemOutcome,
    sources: FactCheckSource[],
    groundedDomains: string[],
  ): void {
    const sourceCount =
      outcome.sources.length > sources.length
        ? `${sources.length}건(받은 ${outcome.sources.length}건에서 자름)`
        : `${sources.length}건`;
    this.logger.log(
      `사실 검증 완료: debateId=${component.debateId}, ` +
        `turn #${component.turnSequence}, status=${outcome.status}, ` +
        `출처 ${sourceCount}, 문장="${summarize(statementOf(component))}"`,
    );

    this.logger.debug(`  근거: ${outcome.reason.trim()}`);
    for (const source of sources) {
      this.logger.debug(
        `  출처: ${source.title} (${source.publisher}) ${source.url}`,
      );
    }
    this.logger.debug(`  검색 도메인: ${groundedDomains.join(', ') || '없음'}`);
  }

  /**
   * 명제 하나의 판정 검사(내부 설계 "Source Validator" + 근거 설명 규칙).
   *
   * LLM은 그럴듯한 URL을 지어낼 수 있고, 검색을 아예 하지 않고도 답을 낼 수 있다.
   * 형식(http/https)과 최소 개수, 그리고 grounding 메타데이터에 실제로 있던 도메인인지를 함께 본다.
   * 근거 설명은 명제와 직접 연결된 것이어야 하므로 토론 평가·승패 조언·발언자 언급을 거른다.
   */
  private validateOutcome(
    outcome: FactCheckItemOutcome,
    groundedDomains: string[],
  ): void {
    const reason = outcome.reason.trim();
    if (reason === '') {
      throw new FactCheckSourceValidationError(
        '검증 근거 설명이 비어 있습니다.',
      );
    }
    if (
      canonicalizeSideTokens(reason) !== reason ||
      FORBIDDEN_REASON_PATTERNS.some((pattern) => pattern.test(reason))
    ) {
      throw new FactCheckReasonValidationError(
        '검증 근거 설명에 명제와 무관한 평가나 발언자 언급이 있습니다.',
      );
    }
    if (STATUSES_WITHOUT_SOURCES.includes(outcome.status)) {
      return;
    }
    if (outcome.sources.length === 0) {
      throw new FactCheckSourceValidationError(
        `${outcome.status} 판정에는 출처가 최소 1건 필요합니다.`,
      );
    }

    const hosts = outcome.sources.map((source) => this.toHostOrThrow(source));

    // 검색 근거가 하나도 없으면 모델이 검색 없이 답한 것이다.
    if (groundedDomains.length === 0) {
      throw new FactCheckSourceValidationError(
        '검색 근거(grounding)가 없어 출처를 신뢰할 수 없습니다.',
      );
    }

    // 출처 도메인 중 최소 하나는 실제 검색 결과에서 온 것이어야 한다.
    const grounded = groundedDomains.map(normalizeHost);
    if (!hosts.some((host) => isGroundedHost(host, grounded))) {
      throw new FactCheckSourceValidationError(
        `출처가 검색 결과와 일치하지 않습니다: ${hosts.join(', ')}`,
      );
    }
  }

  // URL 형식 검사 겸 호스트 추출. http(s)가 아니면 인용할 수 없는 출처다.
  private toHostOrThrow(source: FactCheckSource): string {
    const host = toHost(source.url);
    if (host === null) {
      throw new FactCheckSourceValidationError(
        `출처 URL 형식이 올바르지 않습니다: ${source.url}`,
      );
    }
    return host;
  }

  // 라운드의 확정 턴(발언 순서대로). 검증 대상을 고르는 범위이자 검색어를 풀어낼 맥락이다.
  private async findRoundMessages(
    debateId: string,
    round: DebateRound,
  ): Promise<DebateMessage[]> {
    return this.messages.find({
      where: {
        debateId,
        status: ResourceStatus.NORMAL,
        sequence: In(round.turnIndexes.map((index) => index + 1)),
      },
      order: { sequence: 'ASC' },
    });
  }

  /**
   * 라운드 앵커 턴. 없으면(삭제됐거나, 이 기준 이전의 컴포넌트 단위 작업이라 대상이 턴이 아니면)
   * 다시 해도 의미가 없다 — 판정은 검증 실패에 막히지 않으므로 재시도 불가로 끝낸다.
   */
  private async findAnchorOrThrow(turnId: string): Promise<DebateMessage> {
    const anchor = await this.messages.findOneBy({
      id: turnId,
      status: ResourceStatus.NORMAL,
    });
    if (anchor === null || anchor.sequence === null) {
      throw new NonRetryableTaskError(
        `검증할 라운드의 확정 턴이 없습니다: targetId=${turnId}`,
      );
    }
    return anchor;
  }
}

// 검증한 명제. 검증 명제가 없는 레거시 행은 논증 문장으로 대신한다.
function statementOf(component: DebateArgumentComponent): string {
  return component.factCheckStatement ?? component.statement;
}

// 로그 한 줄에 실을 만큼 문장을 줄인다. 전문은 분석 단계의 debug 로그에 있다.
function summarize(statement: string): string {
  return statement.length <= LOG_STATEMENT_LENGTH
    ? statement
    : `${statement.slice(0, LOG_STATEMENT_LENGTH)}…`;
}

/**
 * 출처를 상한까지만 남긴다. 실제 검색 결과(grounding)와 도메인이 일치하는 출처를 먼저 두고,
 * 같은 그룹 안에서는 모델이 낸 순서를 지킨다 — 잘라낸 뒤에도 검색 근거가 있는 출처가 남도록.
 */
function limitSources(
  sources: FactCheckSource[],
  groundedDomains: string[],
): FactCheckSource[] {
  if (sources.length <= MAX_SOURCES) {
    return sources;
  }
  const grounded = groundedDomains.map(normalizeHost);
  const isGrounded = (source: FactCheckSource): boolean => {
    const host = toHost(source.url);
    return host !== null && isGroundedHost(host, grounded);
  };
  return [
    ...sources.filter(isGrounded),
    ...sources.filter((source) => !isGrounded(source)),
  ].slice(0, MAX_SOURCES);
}

// http(s) URL의 정규화된 호스트. 인용할 수 없는 URL이면 null이다.
function toHost(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return normalizeHost(url.hostname);
}

// 호스트가 검색 결과 도메인과 같거나 그 하위 도메인인지.
function isGroundedHost(host: string, groundedDomains: string[]): boolean {
  return groundedDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

// 도메인 비교용 정규화. grounding 메타데이터의 title은 보통 도메인 문자열이다.
function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}
