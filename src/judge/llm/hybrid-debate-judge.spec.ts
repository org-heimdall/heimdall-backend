import { HybridDebateJudge } from './hybrid-debate-judge';
import {
  DebateCommentary,
  DebateJudgeRequest,
  DebateScoring,
  JudgeCommentator,
  JudgeScorer,
} from './judge-llm';

describe('HybridDebateJudge', () => {
  const request: DebateJudgeRequest = {
    topic: '주제',
    sideANickname: 'a',
    sideBNickname: 'b',
    turns: [],
    components: [],
    relations: [],
    logContext: { debateId: 'debate-1' },
  };

  const scoring: DebateScoring = {
    sideA: {
      argumentationScore: 80,
      interactionScore: 70,
      factualReliabilityScore: 60,
      violations: [
        { type: 'profanity', severity: 'minor', evidence: '아 진짜' },
      ],
    },
    sideB: {
      argumentationScore: 40,
      interactionScore: 50,
      factualReliabilityScore: 55,
      violations: [],
    },
    model: 'jev-1.13.0',
  };

  const commentary: DebateCommentary = {
    sideAFeedback: '{{SIDE_A}} 피드백',
    sideBFeedback: '{{SIDE_B}} 피드백',
    overallReason: '총평',
    model: 'gpt-5.6-luna',
  };

  let score: jest.MockedFunction<JudgeScorer['score']>;
  let comment: jest.MockedFunction<JudgeCommentator['comment']>;
  let judge: HybridDebateJudge;

  beforeEach(() => {
    score = jest.fn().mockResolvedValue(scoring);
    comment = jest.fn().mockResolvedValue(commentary);
    judge = new HybridDebateJudge({ score }, { comment });
  });

  it('Jev 점수·위반과 해설 문장을 합쳐 기존 판정 결과 모양으로 돌려준다', async () => {
    const result = await judge.judge(request);

    expect(result).toEqual({
      sideA: { ...scoring.sideA, feedback: '{{SIDE_A}} 피드백' },
      sideB: { ...scoring.sideB, feedback: '{{SIDE_B}} 피드백' },
      overallReason: '총평',
      model: 'jev-1.13.0+gpt-5.6-luna',
    });
  });

  it('해설자에게 이미 정해진 점수를 넘긴다', async () => {
    await judge.judge(request);

    expect(comment).toHaveBeenCalledWith({ ...request, scoring });
  });

  it('점수 판정이 실패하면 해설을 부르지 않고 그대로 던진다', async () => {
    score.mockRejectedValue(new Error('jev down'));

    await expect(judge.judge(request)).rejects.toThrow('jev down');
    expect(comment).not.toHaveBeenCalled();
  });
});
