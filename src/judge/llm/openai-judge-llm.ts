import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { MAX_SCORE, MIN_SCORE } from '../debate-judge.service';
import { NonRetryableTaskError } from '../judge-task.worker';
import {
  ArgumentComponentKind,
  ArgumentRelationKind,
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

// 1단계, 3단계 (Argument Analyzer, Debate Judge)는 OpenAI API 사용
@Injectable()
export class OpenAiJudgeLlm implements ArgumentAnalyzer, DebateJudge {
  private readonly logger = new Logger(OpenAiJudgeLlm.name);
  private readonly model: string;
  private readonly client: OpenAI | null;

  constructor(configService: ConfigService) {
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
      SYSTEM_PROMPT_ANALYZER,
      buildAnalyzerInput(request),
      AnalyzedGraph,
      'analyzed_graph',
    );

    return {
      components: parsed.components.map((component) => ({
        ref: component.ref,
        kind: component.kind as ArgumentComponentKind,
        statement: component.statement.trim(),
        needsFactCheck: component.needs_fact_check,
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
        SYSTEM_PROMPT_JUDGE,
        input,
        JudgingDebatePerformance,
        'judging_debate_performance',
      ),
      this.parse(
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

    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      text: { format: zodTextFormat(schema, schemaName) },
    });

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

const AnalyzedGraph = z.object({
  components: z.array(
    z.object({
      ref: z.string(), // 이번 응답 안에서만 쓰는 별칭. c1, c2 처럼 붙인다.
      kind: z.enum(
        Object.values(ArgumentComponentKind) as [string, ...string[]],
      ),
      statement: z.string(), // 한 문장으로 다듬은 주장·근거·질문. 원문을 그대로 옮기지 않는다.
      needs_fact_check: z.boolean(),
    }),
  ),
  relations: z.array(
    z.object({
      from_ref: z.string(), // 이번 턴에서 새로 나온 컴포넌트의 ref.
      to_ref: z.string(), // 이번 턴의 ref이거나 앞서 제시된 컴포넌트의 ref(p로 시작).
      kind: z.enum(
        Object.values(ArgumentRelationKind) as [string, ...string[]],
      ),
    }),
  ),
});

const SYSTEM_PROMPT_ANALYZER = [
  '너는 토론 발언에서 논증 구조를 뽑아내는 분석기다.',
  '주어진 발언 하나만 분석하고, 발언에 실제로 담긴 것만 컴포넌트로 만든다. 없는 주장을 지어내지 않는다.',
  '컴포넌트 종류: CLAIM(주장), EVIDENCE(근거·사례·통계), QUESTION(상대에게 던지는 질문), REBUTTAL(상대 주장에 대한 반박).',
  '관계 종류: SUPPORT(뒷받침), ATTACK(반박·부정), QUESTION(질의).',
  '관계의 출발점(from_ref)은 반드시 이번 발언에서 새로 만든 컴포넌트여야 한다.',
  '앞서 제시된 컴포넌트(p로 시작하는 ref)는 도착점(to_ref)으로만 쓸 수 있다.',
  'needs_fact_check는 검색으로 확인 가능한 사실 주장에만 true로 둔다. 비용이 드는 검증이므로 남발하지 않는다.',
  '모든 문장은 한국어로 쓴다.',
].join('\n');

// 이전 컴포넌트는 관계를 이어 붙일 대상으로만 쓰인다.
function buildAnalyzerInput(request: AnalyzerRequest): string {
  const { turn } = request;
  const previous =
    request.previousComponents.length === 0
      ? '(없음)'
      : request.previousComponents
          .map(
            (component) =>
              `- ${component.ref} [${component.speakerSide}/${component.kind}] ${component.statement}`,
          )
          .join('\n');

  return [
    `# 토론 주제\n${request.topic}`,
    `# 앞서 제시된 컴포넌트\n${previous}`,
    `# 분석할 발언`,
    `순서: ${turn.sequence}번째 (${turn.phase} ${turn.round}라운드)`,
    `발언자: ${turn.speakerNickname} (${turn.speakerSide})`,
    `내용:\n${turn.content}`,
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

// 전사 + 논증 그래프 + 검증 결과를 한 덩어리로 만든다.
function buildJudgeInput(request: DebateJudgeRequest): string {
  const transcript = request.turns
    .map(
      (turn) =>
        `[${turn.sequence}] ${turn.speakerNickname}(${turn.speakerSide}) ${turn.phase} ${turn.round}라운드\n${turn.content}`,
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
            return `${component.ref} [${component.speakerSide}/${component.kind}] ${component.statement} (${verified})`;
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
    `# 발언자\nSIDE_A: ${request.sideANickname}\nSIDE_B: ${request.sideBNickname}`,
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
