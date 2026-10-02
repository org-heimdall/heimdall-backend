import { DebateSide } from '../debates/debate-turn';

// 편 → 참여자 닉네임.
export type SideNames = Readonly<Record<DebateSide, string>>;

const SIDE_OF_LETTER: Readonly<Record<string, DebateSide>> = {
  A: DebateSide.SIDE_A,
  B: DebateSide.SIDE_B,
};

// 화면에서 참여자를 부르는 호칭. 판정 문장 속 side 표기는 "닉네임 + 님"으로 바뀐다.
const HONORIFIC = '님';

/**
 * 토큰 바로 뒤에 붙은 조사 → 호칭 뒤에 쓸 형태. "님"은 받침(ㅁ)이 있으므로 받침 있는 형태로 고정한다
 * (닉네임마다 받침을 따지지 않아도 된다). 조사를 늘릴 때는 이 표에만 추가한다.
 */
const JOSA_AFTER_HONORIFIC: Readonly<Record<string, string>> = {
  은: '은',
  는: '은',
  이: '이',
  가: '이',
  을: '을',
  를: '을',
  과: '과',
  와: '과',
  으로: '으로',
  로: '으로',
};

// 토큰 바로 뒤에 붙은 조사. 뒤에 한글이 이어지면 조사가 아니라 다른 단어("이번", "가장")로 본다.
// 조사가 아닌 글자("의" 등)가 붙어 있으면 조사 없이 토큰만 바꾼다.
const JOSA_GROUP = String.raw`(?:(?<josa>${Object.keys(JOSA_AFTER_HONORIFIC).join('|')})(?![가-힣]))?`;

/*
 * LLM이 판정 문장에 흘릴 수 있는 side 표기와 뒤에 붙은 조사. 한 번의 replace로 처리해 바꿔 넣은 닉네임을 다시 훑지 않는다.
 * 1) SIDE_A, SIDE A, side-a — 앞뒤에 영문·숫자가 붙어 있으면 다른 단어로 본다("inside a" 제외)
 * 2) A측, A 측, A편 — 앞에 영문·숫자·한글이 붙어 있으면 다른 단어로 보고, "A측면"은 제외한다
 * 3) 측면 A
 */
const SIDE_TOKEN_PATTERN = new RegExp(
  '(?:' +
    [
      String.raw`(?<![A-Za-z0-9])SIDE[_\s-]?(?<p1>[AB])(?![A-Za-z0-9])`,
      String.raw`(?<![A-Za-z0-9가-힣])(?<p2>[AB])\s?(?:측(?!면)|편)`,
      String.raw`측면\s?(?<p3>[AB])(?![A-Za-z0-9])`,
    ].join('|') +
    ')' +
    JOSA_GROUP,
  'gi',
);

// 변환 뒤에도 남아 있으면 안 되는 흔적. 변환 규칙보다 넓게 잡아 규칙이 놓친 표기(SIDE__A, SIDE_Aand 등)를 찾는다.
const RESIDUAL_SIDE_PATTERN = /(?<![A-Za-z])SIDE[\s_-]*(?<letter>[AB])/gi;

// 강제 치환용. 흔적 패턴에 조사만 덧붙인 것이다.
const SCRUB_SIDE_PATTERN = new RegExp(
  RESIDUAL_SIDE_PATTERN.source + JOSA_GROUP,
  'gi',
);

type MatchGroups = Record<string, string | undefined>;

// 참여자를 화면에서 부르는 말("메시님")에 원문 조사를 호칭에 맞춰 붙인다.
export function toParticipantReference(
  nickname: string,
  josa: string | undefined,
): string {
  const reference = nickname + HONORIFIC;
  return josa === undefined
    ? reference
    : reference + JOSA_AFTER_HONORIFIC[josa];
}

// 문장 속 side 표기를 "닉네임 + 님"으로 바꾸고 뒤의 조사를 호칭에 맞춘다. 한 번의 replace라 바꿔 넣은 이름은 다시 보지 않는다.
export function renderSideTokens(text: string, names: SideNames): string {
  return text.replace(
    SIDE_TOKEN_PATTERN,
    (match: string, ...args: unknown[]) => {
      const groups = args[args.length - 1] as MatchGroups;
      const letter = groups.p1 ?? groups.p2 ?? groups.p3;
      // 2번 패턴은 대소문자를 가리지 않으면 "a측" 같은 오탐이 생기므로 대문자만 side로 본다.
      if (
        letter === undefined ||
        (groups.p2 !== undefined && letter !== letter.toUpperCase())
      ) {
        return match;
      }
      return toParticipantReference(
        names[SIDE_OF_LETTER[letter.toUpperCase()]],
        groups.josa,
      );
    },
  );
}

/**
 * 화면용 문장에 남은 side 흔적(없으면 빈 배열). 닉네임 자체가 "SIDE_A"인 회원을 오탐하지 않도록
 * 참여자 이름을 먼저 지우고 본다.
 */
export function findResidualSideTokens(
  text: string,
  names: SideNames,
): string[] {
  let stripped = text;
  for (const name of Object.values(names)) {
    if (name !== '') {
      stripped = stripped.split(name).join(' ');
    }
  }
  return stripped.match(RESIDUAL_SIDE_PATTERN) ?? [];
}

// 변환 규칙이 놓친 흔적까지 넓은 패턴으로 강제로 "닉네임 + 님"으로 바꾼다. 검사에서 위반이 나왔을 때의 대체 경로다.
export function scrubResidualSideTokens(
  text: string,
  names: SideNames,
): string {
  return text.replace(SCRUB_SIDE_PATTERN, (...args: unknown[]) => {
    const groups = args[args.length - 1] as MatchGroups;
    const letter = groups.letter as string;
    return toParticipantReference(
      names[SIDE_OF_LETTER[letter.toUpperCase()]],
      groups.josa,
    );
  });
}

// 화면에 그대로 노출되는 판정 문장 필드. 여기에 raw side 토큰이 남으면 안 된다.
export const JUDGMENT_TEXT_FIELDS = [
  'overallReason',
  'sideAFeedback',
  'sideBFeedback',
] as const;

export type JudgmentTextField = (typeof JUDGMENT_TEXT_FIELDS)[number];

export type JudgmentTexts = Record<JudgmentTextField, string>;

export interface JudgmentTextViolation {
  field: JudgmentTextField;
  tokens: string[];
}

// 강제 치환으로도 흔적을 지우지 못했을 때 내보내는 문장. raw side 토큰을 내보내는 것보다 낫다.
export const JUDGMENT_TEXT_FALLBACK = '판정 근거를 표시할 수 없습니다.';

// 화면용 문장 필드에 미변환 side 토큰이 남아 있는지 본다. 위반이 없으면 빈 배열이다.
export function validateJudgmentTexts(
  texts: JudgmentTexts,
  names: SideNames,
): JudgmentTextViolation[] {
  return JUDGMENT_TEXT_FIELDS.flatMap((field) => {
    const tokens = findResidualSideTokens(texts[field], names);
    return tokens.length === 0 ? [] : [{ field, tokens }];
  });
}

/**
 * 판정 원문 문장을 화면용으로 바꾼다: side 표기 변환 → 검사 → 위반 필드는 넓은 패턴으로 강제 치환
 * → 그래도 남으면 대체 문장. violations는 첫 검사 결과로, 변환 규칙이 놓친 표기를 호출자가 로깅하는 근거다.
 */
export function renderJudgmentTexts(
  raw: JudgmentTexts,
  names: SideNames,
): { texts: JudgmentTexts; violations: JudgmentTextViolation[] } {
  const texts: JudgmentTexts = {
    overallReason: renderSideTokens(raw.overallReason, names),
    sideAFeedback: renderSideTokens(raw.sideAFeedback, names),
    sideBFeedback: renderSideTokens(raw.sideBFeedback, names),
  };
  const violations = validateJudgmentTexts(texts, names);
  for (const { field } of violations) {
    texts[field] = scrubResidualSideTokens(texts[field], names);
  }
  for (const { field } of validateJudgmentTexts(texts, names)) {
    texts[field] = JUDGMENT_TEXT_FALLBACK;
  }
  return { texts, violations };
}
