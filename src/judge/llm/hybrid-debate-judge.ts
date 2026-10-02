import { Inject, Injectable } from '@nestjs/common';
import { JUDGE_COMMENTATOR, JUDGE_SCORER } from './judge-llm';
import type {
  DebateJudge,
  DebateJudgeRequest,
  DebateJudgeResult,
  JudgeCommentator,
  JudgeScorer,
} from './judge-llm';

@Injectable()
export class HybridDebateJudge implements DebateJudge {
  constructor(
    @Inject(JUDGE_SCORER) private readonly scorer: JudgeScorer,
    @Inject(JUDGE_COMMENTATOR) private readonly commentator: JudgeCommentator,
  ) {}

  /**
   * 점수·위반을 먼저 정하고, 그 점수를 넘겨 문장을 쓰게 한다.
   * 병렬로 돌리면 더 빠르지만 "논증이 훌륭하다"는 피드백에 낮은 점수가 붙는 식으로 서로 어긋날 수 있다.
   */
  async judge(request: DebateJudgeRequest): Promise<DebateJudgeResult> {
    const scoring = await this.scorer.score(request);
    const commentary = await this.commentator.comment({ ...request, scoring });

    return {
      sideA: { ...scoring.sideA, feedback: commentary.sideAFeedback },
      sideB: { ...scoring.sideB, feedback: commentary.sideBFeedback },
      overallReason: commentary.overallReason,
      // 판정에 쓰인 두 모델을 모두 남긴다(예: jev-1.13.0+gpt-5.6-luna).
      model: `${scoring.model}+${commentary.model}`,
    };
  }
}
