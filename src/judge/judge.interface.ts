/** Judge 구현체 주입 토큰. 서비스는 이 토큰으로만 판정기를 참조한다. */
export const JUDGE = Symbol('JUDGE');

export type DebateSide = 'host' | 'opponent';

export interface DebateTranscriptTurn {
  speaker: DebateSide;
  turn: number | null;
  body: string | null;
  imageUrl: string | null;
}

export interface JudgeRequest {
  topic: string;
  host: { nickname: string };
  opponent: { nickname: string };
  turns: DebateTranscriptTurn[];
}

export interface ParticipantJudgment {
  score: number;
  judgeReason: string[];
}

export interface JudgeResult {
  performance: {
    host: ParticipantJudgment;
    opponent: ParticipantJudgment;
    winner: DebateSide | 'draw';
  };
  // TODO: violation의 경우는? 새로운 필드 만들어서 어떻게 정보 저장할건지?
  model: string; // 어떤 모델이 판정했는지 (감사·재현용)
}

/**
 * 토론 판정기. JudgeService는 이 계약에만 의존하므로 판정을 별도 서비스(MSA)로 떼어낼 때
 * judge.module.ts의 구현체 한 줄만 교체하면 된다. OpenAI SDK 타입은 여기에 노출하지 않는다.
 */
export interface Judge {
  judge(request: JudgeRequest): Promise<JudgeResult>;
}
