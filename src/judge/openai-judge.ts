import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { Response } from 'openai/resources/responses/responses';
import { GeneralException } from '../common/exceptions/general.exception';
import { JudgeErrorCode } from './exceptions/judge-error-code';
import type {
  DebateSide,
  DebateViolation,
  Judge,
  JudgeRequest,
  JudgeResult,
  ParticipantJudgment,
} from './judge.interface';
import {
  buildJudgeInput,
  JudgingDebatePerformance,
  JudgingDebateViolation,
  JudgingDebatePerformanceOutput,
  JudgingDebateViolationOutput,
  SYSTEM_PROMPT_PERFORMANCE,
  SYSTEM_PROMPT_VIOLATION,
} from './openai-judge.prompt';

@Injectable()
export class OpenAiJudge implements Judge {
  private readonly logger = new Logger(OpenAiJudge.name);
  private readonly model: string;
  // 키가 없는 로컬 환경에서도 부팅은 되어야 하므로 클라이언트는 선택적으로 만든다.
  private readonly client: OpenAI | null;

  constructor(configService: ConfigService) {
    this.model = configService.getOrThrow<string>('OPENAI_MODEL');

    const apiKey = configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.client = null;
      this.logger.warn(
        'OPENAI_API_KEY가 없어 토론 판정이 비활성화됩니다(판정 요청 시 JUDGE.UNAVAILABLE).',
      );
      return;
    }

    this.client = new OpenAI({
      apiKey,
      timeout: configService.getOrThrow<number>('OPENAI_TIMEOUT_MS'),
      maxRetries: configService.getOrThrow<number>('OPENAI_MAX_RETRIES'),
    });
  }

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    if (!this.client) {
      throw new GeneralException(JudgeErrorCode.UNAVAILABLE);
    }

    // 두 판정은 서로 독립이라 순차로 기다릴 이유가 없다(폴링 대기 시간에 직결된다).
    const [output_performance, output_violation] = await Promise.all([
      this.parseJudgingPerformance(this.client, request),
      this.parseJudgingViolation(this.client, request),
    ]);

    const host_participant_judgement = toParticipantJudgment(
      output_performance.host,
    );
    const opponent_participant_judgement = toParticipantJudgment(
      output_performance.opponent,
    );
    let winner: DebateSide | 'draw' =
      host_participant_judgement.score > opponent_participant_judgement.score
        ? 'host'
        : 'opponent';
    if (
      host_participant_judgement.score == opponent_participant_judgement.score
    )
      winner = 'draw';

    return {
      performance: {
        host: host_participant_judgement,
        opponent: opponent_participant_judgement,
        winner,
      },
      violation: {
        host: toViolations(output_violation.host.violations),
        opponent: toViolations(output_violation.opponent.violations),
      },
      model: this.model,
    };
  }

  private async parseJudgingPerformance(
    client: OpenAI,
    request: JudgeRequest,
  ): Promise<JudgingDebatePerformanceOutput> {
    try {
      const response = await client.responses.parse({
        model: this.model,
        input: [
          {
            role: 'system',
            content: SYSTEM_PROMPT_PERFORMANCE,
          },
          { role: 'user', content: buildJudgeInput(request) },
        ],
        text: {
          format: zodTextFormat(
            JudgingDebatePerformance,
            'judging_debate_performance',
          ),
        },
      });

      // 안전상 거부·토큰 한도 초과·서버 측 실패에서는 스키마를 지키지 못해 파싱 결과가 비어 있다.
      // SDK가 이 경우 예외를 던지지 않으므로 직접 확인한다.
      if (!response.output_parsed) {
        throw new Error(describeUnparsedResponse(response));
      }
      return response.output_parsed;
    } catch (error) {
      // SDK가 네트워크 실패·rate limit·응답 형식 오류를 구분 없이 던져
      // 도메인 사실로 완전히 환원할 수 없다. 원인은 cause로 남겨 로그에서 추적한다.
      throw new GeneralException(JudgeErrorCode.UNAVAILABLE, { cause: error });
    }
  }

  private async parseJudgingViolation(
    client: OpenAI,
    request: JudgeRequest,
  ): Promise<JudgingDebateViolationOutput> {
    try {
      const response = await client.responses.parse({
        model: this.model,
        input: [
          {
            role: 'system',
            content: SYSTEM_PROMPT_VIOLATION,
          },
          { role: 'user', content: buildJudgeInput(request) },
        ],
        text: {
          format: zodTextFormat(
            JudgingDebateViolation,
            'judging_debate_violation',
          ),
        },
      });

      // 안전상 거부·토큰 한도 초과·서버 측 실패에서는 스키마를 지키지 못해 파싱 결과가 비어 있다.
      // SDK가 이 경우 예외를 던지지 않으므로 직접 확인한다.
      if (!response.output_parsed) {
        throw new Error(describeUnparsedResponse(response));
      }
      return response.output_parsed;
    } catch (error) {
      // SDK가 네트워크 실패·rate limit·응답 형식 오류를 구분 없이 던져
      // 도메인 사실로 완전히 환원할 수 없다. 원인은 cause로 남겨 로그에서 추적한다.
      throw new GeneralException(JudgeErrorCode.UNAVAILABLE, { cause: error });
    }
  }
}

/**
 * LLM 응답의 위반 목록을 도메인 계약으로 옮긴다.
 * severity 'none'은 "위반 없음"이므로 항목 자체를 뺀다 — 프롬프트가 넣지 말라고 지시하지만
 * 스키마상으로는 넣을 수 있어 서버에서 한 번 더 거른다.
 */
function toViolations(
  violations: JudgingDebateViolationOutput['host']['violations'],
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

function toParticipantJudgment(
  participant: JudgingDebatePerformanceOutput['host'],
): ParticipantJudgment {
  return {
    score:
      participant.logic_score +
      participant.clarity_score +
      participant.evidence_score +
      participant.rebuttal_score +
      participant.understanding_score,
    judgeReason: participant.judge_reason,
  };
}

// 파싱 실패 원인을 로그에서 구분할 수 있게 응답 상태를 문장으로 옮긴다.
// (거부 · 출력 토큰 한도 초과 · 콘텐츠 필터 · 서버 측 실패는 후속 대응이 서로 다르다)
function describeUnparsedResponse(response: Response): string {
  if (response.status === 'incomplete') {
    return `판정 응답이 완료되지 못했습니다(reason=${response.incomplete_details?.reason ?? 'unknown'}).`;
  }

  if (response.status === 'failed') {
    return `판정 응답 생성이 실패했습니다(${response.error?.code ?? 'unknown'}: ${response.error?.message ?? ''}).`;
  }

  const refusal = findRefusal(response);
  if (refusal !== null) {
    return `모델이 판정을 거부했습니다: ${refusal}`;
  }

  return `판정 응답을 파싱하지 못했습니다(status=${response.status ?? 'unknown'}).`;
}

// 거부는 스키마를 따르지 않고 message content의 refusal 항목으로 온다.
function findRefusal(response: Response): string | null {
  for (const item of response.output) {
    if (item.type !== 'message') {
      continue;
    }
    for (const content of item.content) {
      if (content.type === 'refusal') {
        return content.refusal;
      }
    }
  }
  return null;
}
