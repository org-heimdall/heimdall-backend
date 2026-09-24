/*
 * 명령 처리 결과(ok/error)를 예외 필터에서 어댑터로 전달하는 표식.
 *
 * Nest의 WsProxy는 핸들러 예외를 잡아 필터로 넘긴 뒤 삼키므로, 어댑터가 받는 Observable은
 * 예외가 나도 정상 완료된다. 그래서 필터가 명령 봉투 객체에 실패 표식을 남기고 어댑터가 완료 시점에 읽는다.
 * WeakSet이라 봉투가 GC되면 표식도 함께 사라진다.
 */
const failedCommands = new WeakSet<object>();

// 예외 필터가 처리한 명령을 실패로 표시한다. 봉투가 객체가 아니면(파싱 전 실패 등) 무시한다.
export function markCommandFailed(command: unknown): void {
  if (typeof command === 'object' && command !== null) {
    failedCommands.add(command);
  }
}

export function isCommandFailed(command: object): boolean {
  return failedCommands.has(command);
}
