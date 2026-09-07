import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

export type DebateTurnTimeoutHandler = (debateId: string) => Promise<void>;

/**
 * 토론별 턴 만료 타이머 등록소. 만료 시각이 되면 등록된 처리기를 부르는 일만 하고, 만료되면 무엇을 할지는
 * 모른다(그래서 응용 서비스와 순환 의존이 생기지 않는다).
 *
 * 타이머는 프로세스 로컬이라 다중 인스턴스에서 중복될 수 있지만, 실제 판정은 토론 단위 락 안의
 * 멱등 연산(`DebateChatState.expireTurn`)이라 결과는 한 번만 반영된다.
 */
@Injectable()
export class DebateTurnTimeoutScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger(DebateTurnTimeoutScheduler.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private handler: DebateTurnTimeoutHandler | null = null;

  // 만료 시각에 실행할 동작을 등록한다(`DebateChatService`가 자기 자신을 걸어 둔다).
  register(handler: DebateTurnTimeoutHandler): void {
    this.handler = handler;
  }

  // 현재 차례의 만료 시각에 타이머를 건다(토론당 하나). deadline이 null이면 타이머를 해제한다.
  arm(debateId: string, deadline: Date | null): void {
    this.clear(debateId);
    if (deadline === null) {
      return;
    }
    const timer = setTimeout(
      () => void this.fire(debateId),
      Math.max(0, deadline.getTime() - Date.now()),
    );
    // 타이머 때문에 프로세스가 종료되지 못하는 일이 없게 한다.
    timer.unref();
    this.timers.set(debateId, timer);
  }

  clear(debateId: string): void {
    const timer = this.timers.get(debateId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(debateId);
    }
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private async fire(debateId: string): Promise<void> {
    this.timers.delete(debateId);
    if (this.handler === null) {
      this.logger.warn(
        `턴 만료 처리기가 등록되지 않았다: debateId=${debateId}`,
      );
      return;
    }
    await this.handler(debateId);
  }
}
