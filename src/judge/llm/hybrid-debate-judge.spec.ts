import { DebatePhase, DebateSide } from '../../debates/debate-turn';
import { DebateViolation } from '../judge.types';
import { describeJudgeModels, HybridDebateJudge } from './hybrid-debate-judge';
import type {
  DebateCommentary,
  DebateCommentRequest,
  DebateJudgeRequest,
  DebateScoreResult,
  DebateViolationReport,
} from './judge-llm';

describe('HybridDebateJudge', () => {
  const request: DebateJudgeRequest = {
    topic: 'AI 규제, 필요한가?',
    sideANickname: '메시',
    sideBNickname: '호날두',
    turns: [
      {
        sequence: 1,
        phase: DebatePhase.OPENING,
        round: 1,
        speakerSide: DebateSide.SIDE_A,
        speakerNickname: '메시',
        content: '규제가 필요하다',
      },
    ],
    components: [],
    relations: [],
    logContext: { debateId: 'debate-uuid' },
  };

  const SCORES: DebateScoreResult = {
    sideA: {
      argumentationScore: 70,
      interactionScore: 60,
      factualReliabilityScore: 50,
    },
    sideB: {
      argumentationScore: 80,
      interactionScore: 75,
      factualReliabilityScore: 50,
    },
    model: 'jev-1.13.0',
  };

  const COMMENTARY: DebateCommentary = {
    sideAFeedback: 'A 피드백',
    sideBFeedback: 'B 피드백',
    overallReason: '총평',
    model: 'gpt-5.6-luna',
  };

  const VIOLATION: DebateViolation = {
    type: 'disrespect',
    severity: 'minor',
    evidence: '그건 말도 안 되는 소리다',
  };

  const VIOLATIONS: DebateViolationReport = {
    sideA: [],
    sideB: [VIOLATION],
  };

  let scorer: { score: jest.Mock };
  let commentator: { comment: jest.Mock };
  let violationDetector: { detectViolations: jest.Mock };
  let judge: HybridDebateJudge;

  beforeEach(() => {
    scorer = { score: jest.fn().mockResolvedValue(SCORES) };
    commentator = { comment: jest.fn().mockResolvedValue(COMMENTARY) };
    violationDetector = {
      detectViolations: jest.fn().mockResolvedValue(VIOLATIONS),
    };
    judge = new HybridDebateJudge(scorer, commentator, violationDetector);
  });

  it('점수·피드백·위반을 편별 판정 하나로 조립한다', async () => {
    const result = await judge.judge(request);

    expect(result).toEqual({
      sideA: {
        argumentationScore: 70,
        interactionScore: 60,
        factualReliabilityScore: 50,
        feedback: 'A 피드백',
        violations: [],
      },
      sideB: {
        argumentationScore: 80,
        interactionScore: 75,
        factualReliabilityScore: 50,
        feedback: 'B 피드백',
        violations: [VIOLATION],
      },
      overallReason: '총평',
      model: 'score=jev-1.13.0;feedback=gpt-5.6-luna',
    });
  });

  it('피드백 작성에는 판정 입력과 함께 확정 점수를 넘긴다', async () => {
    await judge.judge(request);

    const [commentRequest] = commentator.comment.mock.calls[0] as [
      DebateCommentRequest,
    ];
    expect(commentRequest).toEqual({
      ...request,
      scores: { sideA: SCORES.sideA, sideB: SCORES.sideB },
    });
  });

  it('피드백은 채점이 끝난 뒤에 쓰고, 위반 평가는 채점을 기다리지 않는다', async () => {
    let resolveScore: (value: DebateScoreResult) => void = () => undefined;
    scorer.score.mockReturnValue(
      new Promise<DebateScoreResult>((resolve) => {
        resolveScore = resolve;
      }),
    );

    const pending = judge.judge(request);
    // 채점이 끝나기 전: 위반 평가는 이미 시작했고 피드백은 아직이다.
    expect(violationDetector.detectViolations).toHaveBeenCalledWith(request);
    expect(commentator.comment).not.toHaveBeenCalled();

    resolveScore(SCORES);
    await pending;
    expect(commentator.comment).toHaveBeenCalledTimes(1);
  });

  it('채점이 실패하면 피드백을 쓰지 않고 판정 전체를 실패로 전파한다', async () => {
    scorer.score.mockRejectedValue(new Error('typesafe down'));

    await expect(judge.judge(request)).rejects.toThrow('typesafe down');
    expect(commentator.comment).not.toHaveBeenCalled();
  });

  it('위반 평가가 실패해도 판정 전체를 실패로 전파한다', async () => {
    violationDetector.detectViolations.mockRejectedValue(
      new Error('openai down'),
    );

    await expect(judge.judge(request)).rejects.toThrow('openai down');
  });

  it('model 열에는 점수 모델과 피드백 모델을 함께 남긴다', () => {
    expect(describeJudgeModels('jev-1.13.0', 'gpt-5.6-luna')).toBe(
      'score=jev-1.13.0;feedback=gpt-5.6-luna',
    );
  });
});
