import { Injectable } from '@nestjs/common';

/**
 * 토론 턴 제한시간 타이머. 서버 1대 전제(in-memory setTimeout)로,
 * 스케일아웃 시에는 Redis 등 외부 스토어 기반 스케줄러로 교체해야 한다.
 */
@Injectable()
export class DebateTimerService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  // debateId 기준으로 타이머를 예약한다. 이미 예약된 타이머가 있으면 먼저 취소해 중복 실행을 막는다.
  schedule(debateId: string, ms: number, callback: () => void): void {
    this.cancel(debateId);
    const timer = setTimeout(() => {
      this.timers.delete(debateId);
      callback();
    }, ms);
    this.timers.set(debateId, timer);
  }

  cancel(debateId: string): void {
    const existing = this.timers.get(debateId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(debateId);
    }
  }

  // debateId에 예약된 타이머가 있는지 여부. 중복 스케줄(예: STARTING 카운트다운 중 재-join) 방지용.
  has(debateId: string): boolean {
    return this.timers.has(debateId);
  }
}
