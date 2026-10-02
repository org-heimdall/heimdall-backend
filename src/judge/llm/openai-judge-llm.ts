import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ResponseUsage } from 'openai/resources/responses/responses';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { MAX_FACT_CHECKS_PER_ROUND } from '../argument-analyzer.service';
import { MAX_SCORE, MIN_SCORE } from '../debate-judge.service';
import { NonRetryableTaskError } from '../judge-task.worker';
import { SIDE_PLACEHOLDERS } from '../judgment-text';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
  ClaimType,
  DebateViolation,
} from '../judge.types';
import {
  AnalyzerRequest,
  AnalyzerResult,
  ArgumentAnalyzer,
  DebateJudge,
  DebateJudgeRequest,
  DebateJudgeResult,
  SideJudgment,
  SILENT_TURN_PLACEHOLDER,
} from './judge-llm';
import { LlmCallLogger, LlmLogContext, LlmTokenUsage } from './llm-call-logger';

// 1단계, 3단계 (Argument Analyzer, Debate Judge)는 OpenAI API 사용
@Injectable()
export class OpenAiJudgeLlm implements ArgumentAnalyzer, DebateJudge {
  private readonly logger = new Logger(OpenAiJudgeLlm.name);
  private readonly model: string;
  private readonly client: OpenAI | null;

  constructor(
    configService: ConfigService,
    private readonly callLogger: LlmCallLogger,
  ) {
    this.model = configService.getOrThrow<string>('OPENAI_MODEL');

    const apiKey = configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.client = null;
      this.logger.warn(
        'OPENAI_API_KEY가 없어 논증 분석·판정을 사용할 수 없습니다.',
      );
      return;
    }
    this.client = new OpenAI({
      apiKey,
      timeout: configService.getOrThrow<number>('OPENAI_TIMEOUT_MS'),
      maxRetries: configService.getOrThrow<number>('OPENAI_MAX_RETRIES'),
    });
  }

  async analyze(request: AnalyzerRequest): Promise<AnalyzerResult> {
    const parsed = await this.parse(
      'analyze',
      request.logContext,
      SYSTEM_PROMPT_ANALYZER,
      buildAnalyzerInput(request),
      AnalyzedGraph,
      'analyzed_graph',
    );

    return {
      components: parsed.components.map((component) => ({
        ref: component.ref,
        turnRef: component.turn_ref,
        kind: component.kind as ArgumentComponentKind,
        statement: component.statement.trim(),
        claimType: component.claim_type as ClaimType,
        needsFactCheck: component.needs_fact_check,
        factCheckStatement: component.fact_check_statement?.trim() || null,
        duplicateOfRef: component.duplicate_of_ref?.trim() || null,
      })),
      relations: parsed.relations.map((relation) => ({
        fromRef: relation.from_ref,
        toRef: relation.to_ref,
        kind: relation.kind as ArgumentRelationKind,
      })),
    };
  }

  async judge(request: DebateJudgeRequest): Promise<DebateJudgeResult> {
    const input = buildJudgeInput(request);

    // 두 판정은 서로 독립이라 순차로 기다릴 이유가 없다(판정 대기 시간에 직결된다).
    const [performance, violation] = await Promise.all([
      this.parse(
        'judge.performance',
        request.logContext,
        SYSTEM_PROMPT_JUDGE,
        input,
        JudgingDebatePerformance,
        'judging_debate_performance',
      ),
      this.parse(
        'judge.violation',
        request.logContext,
        SYSTEM_PROMPT_VIOLATION,
        input,
        JudgingDebateViolation,
        'judging_debate_violation',
      ),
    ]);

    return {
      sideA: toSideJudgment(performance.side_a, violation.side_a.violations),
      sideB: toSideJudgment(performance.side_b, violation.side_b.violations),
      overallReason: performance.judge_reason.trim(),
      model: this.model,
    };
  }

  // 구조화 출력 호출의 공통부. 스키마와 프롬프트만 갈아 끼운다.
  private async parse<T extends z.ZodType>(
    operation: string,
    logContext: LlmLogContext,
    systemPrompt: string,
    input: string,
    schema: T,
    schemaName: string,
  ): Promise<z.infer<T>> {
    if (this.client === null) {
      // 키가 없는 상태는 재시도로 나아지지 않는다.
      throw new NonRetryableTaskError(
        'OPENAI_API_KEY가 없어 실행할 수 없습니다.',
      );
    }

    const client = this.client;
    // 호출마다 소요 시간과 token usage를 남긴다(판정은 두 호출이 병렬이라 두 줄이 남는다).
    const response = await this.callLogger.measure(
      { provider: 'openai', model: this.model, operation, context: logContext },
      () =>
        client.responses.parse({
          model: this.model,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: input },
          ],
          text: { format: zodTextFormat(schema, schemaName) },
        }),
      (result) => toTokenUsage(result.usage),
    );

    // 안전상 거부·토큰 한도 초과·서버 측 실패에서는 스키마를 지키지 못해 파싱 결과가 비어 있다.
    // SDK가 예외를 던지지 않으므로 직접 확인하고 재시도 대상으로 올린다.
    const parsed: unknown = response.output_parsed;
    if (parsed === null || parsed === undefined) {
      throw new Error(
        `${schemaName} 응답을 파싱하지 못했습니다(status=${response.status ?? 'unknown'}).`,
      );
    }
    return parsed as z.infer<T>;
  }
}

// ---------------------------------------------------------------- Argument Analyzer

// OpenAI Responses API의 usage를 공통 로그 모양으로 옮긴다.
function toTokenUsage(usage: ResponseUsage | undefined): LlmTokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? null,
    cachedTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    thinkingTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  };
}

const AnalyzedGraph = z.object({
  components: z.array(
    z.object({
      ref: z.string(), // 이번 응답 안에서만 쓰는 별칭. c1, c2 처럼 붙인다.
      turn_ref: z.string(), // 이 컴포넌트가 나온 발언의 ref(t1, t2 …).
      kind: z.enum(
        Object.values(ArgumentComponentKind) as [string, ...string[]],
      ),
      statement: z.string(), // 한 문장으로 다듬은 주장·근거·질문. 원문을 그대로 옮기지 않는다.
      claim_type: z.enum(Object.values(ClaimType) as [string, ...string[]]),
      needs_fact_check: z.boolean(),
      // needs_fact_check가 true일 때만. 발언자·메타 표현을 뺀 원자적 명제 한 문장.
      fact_check_statement: z.string().nullable(),
      // 이미 검증 대상인 컴포넌트(이전 라운드의 p… 또는 이번 라운드의 c…)와 같은 주장이면 그 ref.
      duplicate_of_ref: z.string().nullable(),
    }),
  ),
  relations: z.array(
    z.object({
      from_ref: z.string(), // 이번 라운드에서 새로 나온 컴포넌트의 ref.
      to_ref: z.string(), // 이번 라운드의 ref이거나 앞서 제시된 컴포넌트의 ref(p로 시작).
      kind: z.enum(
        Object.values(ArgumentRelationKind) as [string, ...string[]],
      ),
    }),
  ),
});

/**
 * 사실 검증 대상 선정 기준. 최종 선별은 서버 정책(FactCheckTargetPolicy)이 하지만, 후보를 처음 고르는 것은
 * 모델이므로 포함·제외 기준과 실제로 틀렸던 사례(temp_example_judge_result)를 그대로 보여 준다.
 */
const FACT_CHECK_TARGET_RULES = [
  '## 사실 검증 대상(needs_fact_check)',
  '사실 검증은 발언자의 조언이나 설득력을 평가하는 단계가 아니다. 한 발언에서 외부 자료로 확인할 수 있는 원자적 사실 주장 하나만 대상으로 한다.',
  '포함: 여론조사 수치·날짜·인원·규모·역사적/과학적 사실, 법률·조약·기관의 공식 입장, 발언자가 특정 보고서·통계·출처를 근거로 제시한 내용.',
  '제외: "~해야 한다", "~이 바람직하다" 같은 규범·정책 제안 / 구체적 조건이나 근거 없는 "~할 수 있다", "~위험이 커질 수 있다" 같은 전망·가정 / 상대 주장에 대한 평가, 출처 요구, 발언자 조언, 단순한 논증 연결 문장.',
  '수치·날짜·법/제도·출처/기관이 들어간 주장을 먼저 고른다.',
  '컴포넌트 하나에는 사실 주장 하나만 둔다. 한 문장에 사실이 둘 이상이면 EVIDENCE 컴포넌트를 나눈다.',
  '같은 라운드 안에서 의미가 같은 주장은 한 번만 검증 대상으로 만든다. 상대가 반박하며 같은 수치·출처를 다시 언급한 것은 검증 대상이 아니다.',
  '앞서 제시된 컴포넌트 중 "검증 명제"가 붙은 것, 또는 이번 라운드에서 먼저 만든 검증 대상과 같은 주장을 다시 말했다면 needs_fact_check를 true로 두고 duplicate_of_ref에 그 ref를 적는다. 서로 다른 주장은 따로 둔다.',
  `needs_fact_check가 true인 컴포넌트는 라운드 전체에서 최대 ${MAX_FACT_CHECKS_PER_ROUND}개까지만 둔다.`,
  'claim_type: STATISTIC(수치·통계·여론조사), CITED_SOURCE(특정 보고서·연구·기관 발표 인용), DATE_EVENT(날짜·사건), LAW_INSTITUTION(법률·조약·제도·기관 공식 입장), HISTORICAL_SCIENTIFIC(역사·과학적 사실), PREDICTION(전망·가정), NORMATIVE(규범·가치판단·정책 제안), META(평가·조언·출처 요구·논증 연결), OPINION(그 밖의 주장). 모든 컴포넌트에 붙인다.',
  'fact_check_statement: 생략된 주어를 복원하고 "발언자는", "~라고 주장한다", "~라고 본다"를 빼서 검증할 명제만 평서문 한 문장으로 쓴다. needs_fact_check가 false면 null이다.',
  '예시:',
  '- ✗ "시뮬레이션에서 제시한 60% 감소 수치의 출처를 확인해야 한다." → META, needs_fact_check=false (출처 요구는 사실 주장이 아니다)',
  '- ✗ fact_check_statement에 "…공식적으로 결론 내렸다고 발언자는 주장한다." → "2025년 NATO 안보 보고서는 …라는 결론을 공식적으로 냈다."처럼 명제만 쓴다',
  '- ✗ "미국은 서울을 지키기 위해 뉴욕이 핵 공격을 받을 위험을 감수해야 하는 상황에 놓일 수 있다." → PREDICTION, needs_fact_check=false',
  '- ✓ "최근 조사에서 국민의 70% 이상이 자체 핵무장에 찬성했다." → STATISTIC, needs_fact_check=true',
].join('\n');

const SYSTEM_PROMPT_ANALYZER = [
  '너는 토론 발언에서 논증 구조를 뽑아내는 분석기다.',
  '주어진 라운드의 발언들(t1, t2 …, 발언 순서대로)을 함께 분석하고, 발언에 실제로 담긴 것만 컴포넌트로 만든다. 없는 주장을 지어내지 않는다.',
  '모든 컴포넌트에는 그것이 나온 발언의 ref를 turn_ref로 적는다.',
  '컴포넌트 종류: CLAIM(주장), EVIDENCE(근거·사례·통계), QUESTION(상대에게 던지는 질문), REBUTTAL(상대 주장에 대한 반박).',
  '관계 종류: SUPPORT(뒷받침), ATTACK(반박·부정), QUESTION(질의).',
  '관계의 출발점(from_ref)은 반드시 이번 라운드에서 새로 만든 컴포넌트여야 한다.',
  '앞서 제시된 컴포넌트(p로 시작하는 ref)는 도착점(to_ref)으로만 쓸 수 있다.',
  '관계는 시간을 거스를 수 없다. 먼저 한 발언의 컴포넌트가 같은 라운드의 나중 발언 컴포넌트를 가리키면 안 된다.',
  `참여자는 입력에서 ${SIDE_PLACEHOLDERS.SIDE_A}, ${SIDE_PLACEHOLDERS.SIDE_B}로 표기된다. statement와 fact_check_statement에는 참여자 표기나 "발언자"를 넣지 않는다.`,
  FACT_CHECK_TARGET_RULES,
  '모든 문장은 한국어로 쓴다.',
].join('\n');

// 이전 컴포넌트는 관계를 이어 붙일 대상이자, 같은 주장을 다시 말했는지 가릴 기준(검증 명제)으로 쓰인다.
function buildAnalyzerInput(request: AnalyzerRequest): string {
  const { round } = request;
  const previous =
    request.previousComponents.length === 0
      ? '(없음)'
      : request.previousComponents
          .map((component) => {
            const target =
              component.factCheckStatement === null
                ? ''
                : ` | 검증 명제: ${component.factCheckStatement}`;
            return `- ${component.ref} [${SIDE_PLACEHOLDERS[component.speakerSide]}/${component.kind}] ${component.statement}${target}`;
          })
          .join('\n');

  const turns = round.turns
    .map(
      (turn) =>
        `## ${turn.ref} — ${turn.sequence}번째 발언, ${SIDE_PLACEHOLDERS[turn.speakerSide]} (${turn.speakerNickname})\n${turn.content}`,
    )
    .join('\n\n');

  return [
    `# 토론 주제\n${request.topic}`,
    `# 앞서 제시된 컴포넌트\n${previous}`,
    `# 분석할 라운드: ${round.phase} ${round.round}라운드`,
    turns,
  ].join('\n\n');
}

// ------------------------------------------------------------------- Judge

const DebatePerformance = z.object({
  argumentation_score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
  interaction_score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
  evidence_score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
  feedback: z.string(),
});

const JudgingDebatePerformance = z.object({
  side_a: DebatePerformance,
  side_b: DebatePerformance,
  judge_reason: z.string(),
});

const Violation = z.object({
  type: z.enum([
    'profanity',
    'personal_attack',
    'disrespect',
    'off_topic',
    'threat',
  ]),
  severity: z.enum(['none', 'minor', 'moderate', 'high', 'severe']),
  evidence: z.string(),
});

const ParticipantViolation = z.object({ violations: z.array(Violation) });

const JudgingDebateViolation = z.object({
  side_a: ParticipantViolation,
  side_b: ParticipantViolation,
});

const SYSTEM_PROMPT_JUDGE = [
  '너는 토론 심판이다. 두 편의 발언과 논증 구조, 사실 검증 결과를 보고 편마다 세 축을 0~100점으로 매긴다.',
  '- 논증(argumentation): 주장이 분명하고 근거가 주장을 실제로 뒷받침하는가.',
  '- 상호작용(interaction): 상대의 주장에 정면으로 응답하고 질문에 답했는가. "논증 관계"의 ATTACK·QUESTION이 상대 편 컴포넌트를 실제로 겨냥하는지, 받은 질문이 뒤에 답변으로 이어지는지를 근거로 삼는다.',
  '- 사실 신뢰도(evidence_score): 제시한 사실 주장이 검증 결과로 뒷받침되는가. 검증 결과가 없는 주장은 중립으로 본다.',
  `${SILENT_TURN_PLACEHOLDER}으로 표시된 차례는 시간 안에 아무 말도 하지 않은 것이다. 그 편에게 유리하게 해석하지 않는다.`,
  '누가 이겼는지는 판단하지 않는다. 점수와 근거만 낸다.',
  `judge_reason과 feedback에서 참여자는 반드시 ${SIDE_PLACEHOLDERS.SIDE_A}, ${SIDE_PLACEHOLDERS.SIDE_B} 표기로만 지칭한다. SIDE_A, A측, 측면 A 같은 표기나 닉네임을 직접 쓰지 않는다.`,
  '모든 문장은 한국어로 쓴다.',
].join('\n');

/**
 * 위반 평가. 판정과 입력은 같고 보는 것만 다르다 — 잘했는지가 아니라 선을 넘었는지를 본다.
 * 결과는 프론트로 나가지 않고 신뢰도 차감의 근거로만 쓰인다.
 */
const SYSTEM_PROMPT_VIOLATION = [
  '너는 토론 대화에서 규칙 위반을 찾아내는 심판이다.',
  '편마다 5가지 항목(profanity, personal_attack, disrespect, off_topic, threat)을 5단계로 평가한다.',
  '- none: 해당 사항이 전혀 없음',
  '- minor: 가벼운 무례함 또는 일회성의 경미한 비매너 발언. 토론 진행에 실질적인 영향을 주지 않는 수준',
  '- moderate: 명확한 무례한 표현, 경미한 인신공격, 일회성 욕설',
  '- high: 명확한 욕설 또는 강한 인신공격, 상대방을 직접 모욕하는 발언, 반복적인 무례한 발언',
  '- severe: 심각한 모욕이나 위협, 지속적·반복적인 욕설/인신공격, 토론을 사실상 방해할 정도의 규칙 위반',
  'none 단계일 경우 배열에 항목을 넣지 않는다.',
  'evidence에는 근거가 된 발언을 그대로 옮긴다.',
  '없는 위반을 지어내지 않는다.',
].join('\n');

/**
 * 전사 + 논증 그래프 + 검증 결과를 한 덩어리로 만든다.
 * 참여자는 어디서나 placeholder로만 표기한다 — 입력에 SIDE_A 같은 내부 값이 보이면 모델이 그대로 문장에 옮긴다.
 * 닉네임은 범례에 한 번만 두어, 발언 속에서 서로를 이름으로 부르는 것을 이해하는 데만 쓰게 한다.
 */
function buildJudgeInput(request: DebateJudgeRequest): string {
  const transcript = request.turns
    .map(
      (turn) =>
        `[${turn.sequence}] ${SIDE_PLACEHOLDERS[turn.speakerSide]} ${turn.phase} ${turn.round}라운드\n${turn.content}`,
    )
    .join('\n\n');

  const components =
    request.components.length === 0
      ? '(추출된 논증 없음)'
      : request.components
          .map((component) => {
            const verified =
              component.factCheck === null
                ? '검증 없음'
                : `${component.factCheck.status}: ${component.factCheck.reason}`;
            return `${component.ref} [${SIDE_PLACEHOLDERS[component.speakerSide]}/${component.kind}] ${component.statement} (${verified})`;
          })
          .join('\n');

  // 간선은 별칭으로만 잇는다. 문장을 두 번 실으면 프롬프트만 커지고 얻는 것이 없다.
  const relations =
    request.relations.length === 0
      ? '(추출된 관계 없음)'
      : request.relations
          .map(
            (relation) =>
              `${relation.fromRef} --${relation.kind}--> ${relation.toRef}`,
          )
          .join('\n');

  return [
    `# 토론 주제\n${request.topic}`,
    `# 참여자\n${SIDE_PLACEHOLDERS.SIDE_A} = ${request.sideANickname}\n${SIDE_PLACEHOLDERS.SIDE_B} = ${request.sideBNickname}`,
    `# 전사\n${transcript}`,
    `# 논증·사실 검증\n${components}`,
    `# 논증 관계 (from --관계--> to)\n${relations}`,
  ].join('\n\n');
}

function toSideJudgment(
  side: z.infer<typeof DebatePerformance>,
  violations: z.infer<typeof ParticipantViolation>['violations'],
): SideJudgment {
  return {
    argumentationScore: side.argumentation_score,
    interactionScore: side.interaction_score,
    factualReliabilityScore: side.evidence_score,
    feedback: side.feedback.trim(),
    violations: toViolations(violations),
  };
}

/**
 * LLM의 위반 목록을 도메인 계약으로 옮긴다.
 * severity 'none'은 "위반 없음"이므로 항목 자체를 뺀다 — 프롬프트가 넣지 말라고 지시하지만
 * 스키마상으로는 넣을 수 있어 서버에서 한 번 더 거른다.
 */
function toViolations(
  violations: z.infer<typeof ParticipantViolation>['violations'],
): DebateViolation[] {
  return violations.flatMap((violation) =>
    violation.severity === 'none'
      ? []
      : [
          {
            type: violation.type,
            severity: violation.severity,
            evidence: violation.evidence,
          },
        ],
  );
}
