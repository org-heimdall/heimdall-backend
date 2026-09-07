import { DebateTurnTimeoutScheduler } from './debate-turn-timeout.scheduler';

describe('DebateTurnTimeoutScheduler', () => {
  const DEBATE_ID = 'debate-uuid';
  const TURN_MS = 180_000;

  let handler: jest.Mock;
  let scheduler: DebateTurnTimeoutScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    handler = jest.fn().mockResolvedValue(undefined);
    scheduler = new DebateTurnTimeoutScheduler();
    scheduler.register(handler);
  });

  afterEach(() => {
    scheduler.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('만료 시각이 되면 등록된 처리기를 부른다', async () => {
    scheduler.arm(DEBATE_ID, new Date(Date.now() + TURN_MS));

    await jest.advanceTimersByTimeAsync(TURN_MS - 1);
    expect(handler).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledWith(DEBATE_ID);
  });

  it('이미 지난 만료 시각은 곧바로 처리한다(부팅 복구)', async () => {
    scheduler.arm(DEBATE_ID, new Date(Date.now() - TURN_MS));

    await jest.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('토론당 타이머는 하나뿐이라 다시 걸면 앞선 타이머는 사라진다', async () => {
    scheduler.arm(DEBATE_ID, new Date(Date.now() + TURN_MS));
    scheduler.arm(DEBATE_ID, new Date(Date.now() + TURN_MS * 2));

    await jest.advanceTimersByTimeAsync(TURN_MS * 2);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deadline이 null이면 타이머를 해제한다(종료된 토론)', async () => {
    scheduler.arm(DEBATE_ID, new Date(Date.now() + TURN_MS));
    scheduler.arm(DEBATE_ID, null);

    await jest.advanceTimersByTimeAsync(TURN_MS * 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it('종료 시 남은 타이머를 모두 정리한다', async () => {
    scheduler.arm('debate-1', new Date(Date.now() + TURN_MS));
    scheduler.arm('debate-2', new Date(Date.now() + TURN_MS));

    scheduler.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(TURN_MS * 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it('처리기가 등록되지 않았어도 만료 시각에 죽지 않는다', async () => {
    const bare = new DebateTurnTimeoutScheduler();
    bare.arm(DEBATE_ID, new Date(Date.now() + TURN_MS));

    await expect(
      jest.advanceTimersByTimeAsync(TURN_MS),
    ).resolves.toBeUndefined();
  });
});
