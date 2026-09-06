import { Injectable } from '@nestjs/common';
import { DebateChatState } from './debate-chat-state';

export const DEBATE_CHAT_STATE_STORE = Symbol('DEBATE_CHAT_STATE_STORE');

/**
 * 토론 채팅 상태 저장소. 서비스는 이 계약에만 의존하므로 Phase 2에서 DB/Redis 구현체로 바꿔도
 * 서비스·게이트웨이는 그대로다.
 */
export interface DebateChatStateStore {
  /**
   * debateId의 상태를 읽고(없으면 initialize로 만들고) work를 적용한다.
   * 같은 debateId에 대한 호출은 직렬화되어 append/finalize가 겹치지 않는다는 것이 계약이다.
   */
  withState<T>(
    debateId: string,
    initialize: () => Promise<DebateChatState>,
    work: (state: DebateChatState) => T | Promise<T>,
  ): Promise<T>;
}

/**
 * Phase 1 저장소: 프로세스 메모리. 재시작하면 사라지고 다중 인스턴스에서 공유되지 않는다.
 * debateId별 promise 체인으로 호출을 직렬화해 같은 토론의 동시 명령이 상태를 어긋나게 하지 않는다.
 */
@Injectable()
export class InMemoryDebateChatStateStore implements DebateChatStateStore {
  private readonly states = new Map<string, DebateChatState>();
  // debateId별 마지막 작업. 다음 작업은 이 promise가 끝난 뒤 시작한다(실패해도 체인은 이어진다).
  private readonly tails = new Map<string, Promise<unknown>>();

  async withState<T>(
    debateId: string,
    initialize: () => Promise<DebateChatState>,
    work: (state: DebateChatState) => T | Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(debateId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        let state = this.states.get(debateId);
        if (!state) {
          state = await initialize();
          this.states.set(debateId, state);
        }
        return work(state);
      });

    this.tails.set(debateId, run);
    try {
      return await run;
    } finally {
      // 내가 마지막 작업이면 체인을 비워 Map이 무한히 자라지 않게 한다.
      if (this.tails.get(debateId) === run) {
        this.tails.delete(debateId);
      }
    }
  }
}
