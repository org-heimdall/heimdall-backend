import { Logger, OnApplicationShutdown } from '@nestjs/common';

export type DeadlineHandler = (id: string) => Promise<void>;

/**
 * id별 마감 타이머 등록소. 마감 시각이 되면 등록된 처리기를 부르는 일만 하고, 무엇을 할지는
 * 모른다(그래서 응용 서비스와 순환 의존이 생기지 않는다).
 *
 * 타이머는 프로세스 로컬이라 다중 인스턴스에서 중복될 수 있다. 중복 발화가 결과를 두 번 만들지
 * 않게 하는 것(락 안의 멱등 연산·조건부 UPDATE)은 처리기를 등록한 쪽의 몫이다.
 *
 * 도메인별 스케줄러는 이 클래스를 상속해 DI 토큰만 따로 가진다 — 인스턴스마다 자기 처리기와
 * 타이머 맵을 가지므로 서로 간섭하지 않는다.
 */
export class DeadlineScheduler implements OnApplicationShutdown {
  // 상속한 클래스 이름으로 로그가 남도록 생성 시점의 실제 클래스 이름을 쓴다.
  private readonly logger = new Logger(this.constructor.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private handler: DeadlineHandler | null = null;

  // 마감 시각에 실행할 동작을 등록한다(응용 서비스가 자기 자신을 걸어 둔다).
  register(handler: DeadlineHandler): void {
    this.handler = handler;
  }

  // 마감 시각에 타이머를 건다(id당 하나). deadline이 null이면 타이머를 해제한다.
  arm(id: string, deadline: Date | null): void {
    this.clear(id);
    if (deadline === null) {
      return;
    }
    const timer = setTimeout(
      () => void this.fire(id),
      Math.max(0, deadline.getTime() - Date.now()),
    );
    // 타이머 때문에 프로세스가 종료되지 못하는 일이 없게 한다.
    timer.unref();
    this.timers.set(id, timer);
  }

  clear(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private async fire(id: string): Promise<void> {
    this.timers.delete(id);
    if (this.handler === null) {
      this.logger.warn(`마감 처리기가 등록되지 않았다: id=${id}`);
      return;
    }
    await this.handler(id);
  }
}
