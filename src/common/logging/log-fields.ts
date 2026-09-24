// 한 줄 로그의 필드 값. undefined는 필드 생략, null은 "값을 알 수 없음"이다.
export type LogFieldValue =
  | string
  | number
  | readonly string[]
  | null
  | undefined;

// 미제공 값의 표기. 0과 구분해야 외부 집계에서 실측과 섞이지 않는다.
export const UNKNOWN_LOG_VALUE = 'unknown';

/**
 * 필드 목록을 logfmt 형식의 key=value 한 줄로 만든다. 순서는 넘긴 순서를 그대로 따른다.
 * 배열은 쉼표로 잇고, 공백·따옴표·= 가 섞인 값(에러 메시지 등)은 따옴표로 감싸 한 필드로 읽히게 한다.
 */
export function formatLogFields(
  fields: readonly (readonly [string, LogFieldValue])[],
): string {
  return fields
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
}

function formatValue(value: LogFieldValue): string {
  if (value === null || value === undefined) {
    return UNKNOWN_LOG_VALUE;
  }
  const text = typeof value === 'object' ? value.join(',') : String(value);
  return text === '' || /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}
