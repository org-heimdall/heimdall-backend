import { Injectable } from '@nestjs/common';

@Injectable()
export class DebateTimerService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  // debateId 기준으로 in-memory setTimeout을 예약한다. 이미 있으면 먼저 취소한다. 스케일아웃 시 Redis 등 외부 스케줄러로 교체해야 한다.
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
