import { Inject, Injectable } from '@nestjs/common';
import {
  DEBATE_COMMENTATOR,
  DEBATE_SCORER,
  VIOLATION_DETECTOR,
} from './judge-llm';
import type {
  DebateCommentary,
  DebateCommentator,
  DebateJudge,
  DebateJudgeRequest,
  DebateJudgeResult,
  DebateScorer,
  DebateScoreResult,
  ViolationDetector,
} from './judge-llm';

// 판정 결과의 model 열(varchar 100)에 남기는 형식. 점수와 피드백을 낸 모델이 다르므로 둘 다 남긴다.
export function describeJudgeModels(
  scoreModel: string,
  feedbackModel: string,
): string {
  return `score=${scoreModel};feedback=${feedbackModel}`;
}

@Injectable()
export class HybridDebateJudge implements DebateJudge {
  constructor(
    @Inject(DEBATE_SCORER) private readonly scorer: DebateScorer,
    @Inject(DEBATE_COMMENTATOR)
    private readonly commentator: DebateCommentator,
    @Inject(VIOLATION_DETECTOR)
    private readonly violationDetector: ViolationDetector,
  ) {}

  /**
   * 점수(Scorer)·피드백(Commentator)·위반(ViolationDetector)을 하나의 판정으로 조립한다.
   * 판정 서비스는 DebateJudge 포트만 알므로 각 역할의 벤더를 바꿔도 서비스는 그대로다.
   * 위반 평가는 점수와 무관하므로 처음부터 병렬로 돌린다. 피드백은 확정 점수를 설명해야 하므로
   * 채점 뒤에 이어 붙인다 — 채점이 빠르기 때문에 전체 대기 시간은 거의 늘지 않는다.
   * 어느 한쪽이라도 실패하면 판정 전체가 실패한다(작업 재시도로 넘어간다).
   */
  async judge(request: DebateJudgeRequest): Promise<DebateJudgeResult> {
    const [{ scores, commentary }, violations] = await Promise.all([
      this.scoreThenComment(request),
      this.violationDetector.detectViolations(request),
    ]);

    return {
      sideA: {
        ...scores.sideA,
        feedback: commentary.sideAFeedback,
        violations: violations.sideA,
      },
      sideB: {
        ...scores.sideB,
        feedback: commentary.sideBFeedback,
        violations: violations.sideB,
      },
      overallReason: commentary.overallReason,
      model: describeJudgeModels(scores.model, commentary.model),
    };
  }

  // 점수를 먼저 확정하고, 그 점수를 피드백 입력으로 넘긴다.
  private async scoreThenComment(
    request: DebateJudgeRequest,
  ): Promise<{ scores: DebateScoreResult; commentary: DebateCommentary }> {
    const scores = await this.scorer.score(request);
    const commentary = await this.commentator.comment({
      ...request,
      scores: { sideA: scores.sideA, sideB: scores.sideB },
    });
    return { scores, commentary };
  }
}
