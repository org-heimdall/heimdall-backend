import { DebatePhase, DebateTurnSchedule } from '../debates/debate-turn';
import { Debate } from '../debates/entities/debate.entity';
import { NonRetryableTaskError } from './judge-task.worker';

export interface JudgeTurnSlot {
  phase: DebatePhase;
  round: number;
}

// 발언 순서(sequence, 1부터)에서 phase·round를 파생한다. 규칙은 토론 스케줄 하나에만 있다.
// 범위를 벗어나면 다시 시도해도 달라지지 않으므로 재시도 불가 실패다.
export function resolveTurnSlot(
  debate: Debate,
  sequence: number,
): JudgeTurnSlot {
  const slot = new DebateTurnSchedule(debate.rebuttalQuestionRounds).at(
    sequence - 1,
  );
  if (slot === null) {
    throw new NonRetryableTaskError(
      `스케줄 범위를 벗어난 턴입니다: sequence=${sequence}`,
    );
  }
  return { phase: slot.phase, round: slot.round };
}
