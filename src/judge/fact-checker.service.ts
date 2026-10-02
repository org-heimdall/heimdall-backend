import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceStatus } from '../common/entities/resource-status.enum';
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
import { resolveTurnSlot } from './judge-turn-slot';
import { DebateArgumentComponent } from './entities/debate-argument.entity';
import { JudgeTask } from './entities/judge-task.entity';
import { FACT_CHECKER } from './llm/judge-llm';
import type { FactCheckOutcome, FactChecker } from './llm/judge-llm';

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

// Source Validator가 거부한 결과. 다시 물으면 달라질 수 있으므로 재시도 대상이다.
export class FactCheckSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactCheckSourceValidationError';
  }
}

/**
 * 컴포넌트 하나의 사실 검증. 대상(task.targetId)은 논증 컴포넌트다.
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

  // 검증도 결국 어떤 턴의 발언에서 나온 것이므로 턴 번호를 남긴다.
  async describe(task: JudgeTask): Promise<string | null> {
    const component = await this.results.findComponentById(task.targetId);
    return component === null ? null : `turn #${component.turnSequence}`;
  }

  async handle(task: JudgeTask): Promise<void> {
    const component = await this.findComponentOrThrow(task.targetId);
    const debate = await this.debates.findOneOrThrow(task.debateId);
    const slot = resolveTurnSlot(debate, component.turnSequence);

    const checked = await this.factChecker.check({
      topic: debate.topic,
      statement: component.statement,
      context: await this.loadContext(component),
      logContext: {
        stage: 'grounded_check',
        debateId: task.debateId,
        phase: slot.phase,
        round: slot.round,
        targets: [component.id],
      },
    });

    // 지어낸 출처·검색 없는 판정을 거른다. 거부되면 예외가 올라가 worker가 재시도한다.
    this.validateSources(checked);
    const outcome = { ...checked, sources: limitSources(checked) };
    this.logOutcome(component, outcome, checked.sources.length);

    await this.results.replaceFactCheck({
      debateId: task.debateId,
      componentId: component.id,
      status: outcome.status,
      reason: outcome.reason.trim(),
      sources: outcome.sources,
    });
  }

  /**
   * 검증 결과를 로그로 남긴다. 판정 한 줄은 log, 근거·출처·검색 도메인은 debug다.
   * 검증 문장은 분석 단계가 이미 전문을 남겼으므로 여기서는 줄여 싣는다.
   * 출처가 상한으로 잘렸으면 원래 건수를 함께 남긴다.
   */
  private logOutcome(
    component: DebateArgumentComponent,
    outcome: FactCheckOutcome,
    receivedSourceCount: number,
  ): void {
    const sourceCount =
      receivedSourceCount > outcome.sources.length
        ? `${outcome.sources.length}건(받은 ${receivedSourceCount}건에서 자름)`
        : `${outcome.sources.length}건`;
    this.logger.log(
      `사실 검증 완료: debateId=${component.debateId}, ` +
        `turn #${component.turnSequence}, status=${outcome.status}, ` +
        `출처 ${sourceCount}, 문장="${summarize(component.statement)}"`,
    );

    this.logger.debug(`  근거: ${outcome.reason.trim()}`);
    for (const source of outcome.sources) {
      this.logger.debug(
        `  출처: ${source.title} (${source.publisher}) ${source.url}`,
      );
    }
    this.logger.debug(
      `  검색 도메인: ${outcome.groundedDomains.join(', ') || '없음'}`,
    );
  }

  /**
   * 검증 결과의 출처 검사(내부 설계 "Source Validator").
   *
   * LLM은 그럴듯한 URL을 지어낼 수 있고, 검색을 아예 하지 않고도 답을 낼 수 있다.
   * 형식(http/https)과 최소 개수, 그리고 grounding 메타데이터에 실제로 있던 도메인인지를 함께 본다.
   */
  private validateSources(outcome: FactCheckOutcome): void {
    if (outcome.reason.trim() === '') {
      throw new FactCheckSourceValidationError(
        '검증 근거 설명이 비어 있습니다.',
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
    if (outcome.groundedDomains.length === 0) {
      throw new FactCheckSourceValidationError(
        '검색 근거(grounding)가 없어 출처를 신뢰할 수 없습니다.',
      );
    }

    // 출처 도메인 중 최소 하나는 실제 검색 결과에서 온 것이어야 한다.
    const grounded = outcome.groundedDomains.map(normalizeHost);
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

  // 검증 문장이 나온 발언 원문. 대명사·생략된 주어를 검색어로 풀어내는 데 쓴다.
  private async loadContext(
    component: DebateArgumentComponent,
  ): Promise<string> {
    const turn = await this.messages.findOneBy({
      id: component.turnId,
      status: ResourceStatus.NORMAL,
    });
    return turn?.body ?? component.statement;
  }

  // 컴포넌트가 사라졌다면(재분석으로 교체) 이 작업은 다시 해도 의미가 없다.
  private async findComponentOrThrow(
    componentId: string,
  ): Promise<DebateArgumentComponent> {
    const component = await this.results.findComponentById(componentId);
    if (component === null) {
      throw new NonRetryableTaskError(
        `검증할 컴포넌트가 없습니다: componentId=${componentId}`,
      );
    }
    return component;
  }
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
function limitSources(outcome: FactCheckOutcome): FactCheckSource[] {
  if (outcome.sources.length <= MAX_SOURCES) {
    return outcome.sources;
  }
  const grounded = outcome.groundedDomains.map(normalizeHost);
  const isGrounded = (source: FactCheckSource): boolean => {
    const host = toHost(source.url);
    return host !== null && isGroundedHost(host, grounded);
  };
  return [
    ...outcome.sources.filter(isGrounded),
    ...outcome.sources.filter((source) => !isGrounded(source)),
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
