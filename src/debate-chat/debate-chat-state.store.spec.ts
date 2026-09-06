import { DebateChatState } from './debate-chat-state';
import { InMemoryDebateChatStateStore } from './debate-chat-state.store';

describe('InMemoryDebateChatStateStore', () => {
  let store: InMemoryDebateChatStateStore;

  // 저장소는 상태 객체를 불투명하게 다루므로 실제 애그리거트 대신 식별 가능한 스텁을 쓴다.
  const stub = (debateId: string) =>
    ({ debateId }) as unknown as DebateChatState;

  const defer = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  beforeEach(() => {
    store = new InMemoryDebateChatStateStore();
  });

  it('처음 접근 시에만 initialize를 호출하고 이후에는 같은 상태를 재사용한다', async () => {
    const initialize = jest.fn().mockResolvedValue(stub('d1'));

    const first = await store.withState('d1', initialize, (s) => s);
    const second = await store.withState('d1', initialize, (s) => s);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('같은 debateId의 작업은 앞선 작업이 끝난 뒤 순서대로 실행된다', async () => {
    const initialize = jest.fn().mockResolvedValue(stub('d1'));
    const started = defer();
    const gate = defer();
    const order: string[] = [];

    const slow = store.withState('d1', initialize, async () => {
      order.push('slow:start');
      started.resolve();
      await gate.promise;
      order.push('slow:end');
    });
    const fast = store.withState('d1', initialize, () => {
      order.push('fast');
    });

    // slow가 시작된 뒤 이벤트 루프를 한 바퀴 더 돌려도 fast는 시작하지 못한다.
    await started.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['slow:start']);

    gate.resolve();
    await Promise.all([slow, fast]);
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  it('다른 debateId의 작업은 서로를 기다리지 않는다', async () => {
    const gate = defer();
    const order: string[] = [];

    const blocked = store.withState(
      'd1',
      () => Promise.resolve(stub('d1')),
      async () => {
        await gate.promise;
        order.push('d1');
      },
    );
    await store.withState(
      'd2',
      () => Promise.resolve(stub('d2')),
      () => {
        order.push('d2');
      },
    );

    expect(order).toEqual(['d2']);
    gate.resolve();
    await blocked;
  });

  it('앞선 작업이 실패해도 다음 작업은 실행되고, 실패는 호출자에게 그대로 전달된다', async () => {
    const initialize = jest.fn().mockResolvedValue(stub('d1'));

    const failed = store.withState('d1', initialize, () => {
      throw new Error('boom');
    });
    const next = store.withState('d1', initialize, () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('initialize가 실패하면 상태를 저장하지 않아 다음 호출이 다시 initialize를 시도한다', async () => {
    const initialize = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(stub('d1'));

    await expect(store.withState('d1', initialize, (s) => s)).rejects.toThrow(
      'db down',
    );
    await expect(store.withState('d1', initialize, (s) => s)).resolves.toEqual(
      stub('d1'),
    );
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});
