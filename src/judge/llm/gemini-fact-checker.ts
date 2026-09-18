import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';
import * as z from 'zod';
import { NonRetryableTaskError } from '../judge-task.worker';
import { VerificationStatus } from '../judge.types';
import { FactCheckOutcome, FactCheckRequest, FactChecker } from './judge-llm';

// 2단계 (Fact Checker)는 Gemini API 사용
const RESPONSE_JSON_SCHEMA: z.core.JSONSchema.BaseSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: Object.values(VerificationStatus),
      description: '검증 결과.',
    },
    reason: {
      type: 'string',
      description: '왜 그렇게 판정했는지 한국어 두세 문장.',
    },
    sources: {
      type: 'array',
      description: '판정 근거가 된 출처. 검색 결과에 실제로 있던 것만 넣는다.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '문서 제목.' },
          publisher: { type: 'string', description: '발행 매체·기관 이름.' },
          url: { type: 'string', description: '원문 URL.' },
        },
        required: ['title', 'publisher', 'url'],
      },
    },
  },
  required: ['status', 'reason', 'sources'],
};

// 응답 검증기. 스키마를 어기면 throw되고 worker가 재시도로 넘긴다.
const RESPONSE_VALIDATOR = z.fromJSONSchema(RESPONSE_JSON_SCHEMA);

const SYSTEM_INSTRUCTION = [
  '너는 토론 발언의 사실 여부를 검증하는 팩트체커다.',
  'Google 검색으로 근거를 찾은 뒤에만 판정한다. 검색으로 확인하지 못한 것은 INSUFFICIENT_EVIDENCE로 둔다.',
  '출처는 검색 결과에 실제로 있던 문서만 넣고, URL을 지어내지 않는다.',
  'SUPPORTED(뒷받침됨) · CONTRADICTED(반대 근거) · PARTIALLY_SUPPORTED(일부만) · INSUFFICIENT_EVIDENCE(자료 부족) · NOT_VERIFIABLE(검증 대상 아님) · OUTDATED(과거엔 맞았으나 현재는 아님) 중에서 고른다.',
  '설명은 한국어로 쓴다.',
].join('\n');

@Injectable()
export class GeminiFactChecker implements FactChecker {
  private readonly logger = new Logger(GeminiFactChecker.name);
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly client: GoogleGenAI | null;

  constructor(configService: ConfigService) {
    this.model = configService.getOrThrow<string>('GEMINI_MODEL');
    this.timeoutMs = configService.getOrThrow<number>('GEMINI_TIMEOUT_MS');

    const apiKey = configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.client = null;
      this.logger.warn('GEMINI_API_KEY가 없어 사실 검증을 사용할 수 없습니다.');
      return;
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async check(request: FactCheckRequest): Promise<FactCheckOutcome> {
    if (this.client === null) {
      // 키가 없는 상태는 재시도로 나아지지 않는다.
      throw new NonRetryableTaskError(
        'GEMINI_API_KEY가 없어 사실 검증을 실행할 수 없습니다.',
      );
    }

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildInput(request),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        httpOptions: { timeout: this.timeoutMs },
      },
    });

    // 검증을 통과한 값만 이 자리에 온다 — 모양 보증은 위의 스키마가 한다.
    const outcome = RESPONSE_VALIDATOR.parse(
      JSON.parse(response.text ?? ''),
    ) as Omit<FactCheckOutcome, 'groundedDomains'>;

    return { ...outcome, groundedDomains: extractGroundedDomains(response) };
  }
}

// 검증 대상과 맥락을 한 덩어리로. 문장만 주면 대명사·생략된 주어를 검색할 수 없다.
function buildInput(request: FactCheckRequest): string {
  return [
    `# 토론 주제\n${request.topic}`,
    `# 발언 맥락\n${request.context}`,
    `# 검증할 문장\n${request.statement}`,
  ].join('\n\n');
}

/**
 * grounding 메타데이터에서 실제로 참조된 출처의 도메인을 뽑는다.
 * groundingChunks의 uri는 리다이렉트 주소이고 title에 도메인이 담기므로 둘 다 훑는다.
 */
function extractGroundedDomains(response: GenerateContentResponse): string[] {
  const chunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const domains = new Set<string>();

  for (const chunk of chunks) {
    const web = chunk.web;
    if (web === undefined) {
      continue;
    }
    if (web.domain !== undefined && web.domain !== '') {
      domains.add(web.domain);
    }
    if (web.title !== undefined && web.title !== '') {
      domains.add(web.title);
    }
  }
  return [...domains];
}
