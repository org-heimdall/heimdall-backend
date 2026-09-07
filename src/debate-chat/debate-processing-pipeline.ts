import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { DebateChatPublisher } from './debate-chat.publisher';
import {
  DebateProcessingStage,
  DebateProcessingStageStatus,
} from './debate-chat.types';

export const DEBATE_PROCESSING_PIPELINE = Symbol('DEBATE_PROCESSING_PIPELINE');

/**
 * 토론 종료 후 처리(Analyzer → FactCheck → Judge). 진행 상황은 debate.processing.stage로 방에 알린다.
 * Phase 1은 mock, Phase 3에서 LLM 구현체로 교체한다. 호출자는 완료를 기다리지 않는다.
 */
export interface DebateProcessingPipeline {
  start(debateId: string): Promise<void>;
}

// 단계 사이 지연. 프론트 진행 UI가 눈으로 확인될 정도면 충분하다.
export const MOCK_STAGE_DELAY_MS = 500;

const STAGES: readonly DebateProcessingStage[] = [
  DebateProcessingStage.ANALYZER,
  DebateProcessingStage.FACT_CHECK,
  DebateProcessingStage.JUDGE,
];

// Phase 1 파이프라인: LLM을 부르지 않고 각 단계의 STARTED/COMPLETED만 순서대로 흘린다.
@Injectable()
export class MockDebateProcessingPipeline implements DebateProcessingPipeline {
  private readonly logger = new Logger(MockDebateProcessingPipeline.name);

  constructor(private readonly publisher: DebateChatPublisher) {}

  async start(debateId: string): Promise<void> {
    this.logger.log(`mock 처리 파이프라인 시작: debateId=${debateId}`);
    for (const stage of STAGES) {
      this.publish(debateId, stage, DebateProcessingStageStatus.STARTED);
      await sleep(MOCK_STAGE_DELAY_MS);
      this.publish(debateId, stage, DebateProcessingStageStatus.COMPLETED);
    }
  }

  private publish(
    debateId: string,
    stage: DebateProcessingStage,
    status: DebateProcessingStageStatus,
  ): void {
    this.publisher.processingStage({
      debateId,
      stage,
      status,
      attempt: 1,
      message: `[mock] ${stage} ${status}`,
      occurredAt: new Date().toISOString(),
    });
  }
}
