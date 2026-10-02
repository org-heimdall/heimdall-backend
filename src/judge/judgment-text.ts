import { DebateSide } from '../debates/debate-turn';

// 판정 문장 안에서 참여자를 가리키는 자리 표시. LLM에게 이 표기로만 쓰게 하고, 화면에 낼 때 닉네임으로 바꾼다.
export const SIDE_PLACEHOLDERS: Readonly<Record<DebateSide, string>> = {
  [DebateSide.SIDE_A]: '{{SIDE_A}}',
  [DebateSide.SIDE_B]: '{{SIDE_B}}',
};

/*
 * LLM이 흘릴 수 있는 side 표기들. 한 번의 replace로 처리해야 이미 바꾼 placeholder 안의 SIDE_A를
 * 다시 잡지 않는다(정규식 replace는 바꾼 자리를 다시 훑지 않는다). 그래서 placeholder 자체도 첫 대안으로 둔다.
 * 1) {{ SIDE_A }} — 공백 변형 포함
 * 2) SIDE_A, SIDE A, side-a — 영문·숫자가 바로 붙어 있으면 다른 단어로 본다
 * 3) A측, A 측, A편 — 앞에 영문·숫자·한글이 붙어 있으면 다른 단어로 보고, "A측면"은 제외한다
 * 4) 측면 A
 */
const SIDE_TOKEN_PATTERN = new RegExp(
  [
    String.raw`\{\{\s*SIDE[_\s-]?(?<p1>[AB])\s*\}\}`,
    String.raw`(?<![A-Za-z0-9])SIDE[_\s-]?(?<p2>[AB])(?![A-Za-z0-9])`,
    String.raw`(?<![A-Za-z0-9가-힣])(?<p3>[AB])\s?(?:측(?!면)|편)`,
    String.raw`측면\s?(?<p4>[AB])(?![A-Za-z0-9])`,
  ].join('|'),
  'gi',
);

// 정규화 뒤에도 남아 있으면 안 되는 흔적. 재시도를 남발하지 않도록 좁게 둔다.
const RESIDUAL_PATTERNS: readonly RegExp[] = [
  /SIDE[\s_-]*[AB]/gi,
  /\{\{|\}\}/g,
];

const SIDE_OF_LETTER: Readonly<Record<string, DebateSide>> = {
  A: DebateSide.SIDE_A,
  B: DebateSide.SIDE_B,
};

// 여러 side 표기를 placeholder 하나로 모은다. 몇 번을 적용해도 결과가 같다.
export function canonicalizeSideTokens(text: string): string {
  return text.replace(
    SIDE_TOKEN_PATTERN,
    (match: string, ...args: unknown[]) => {
      const groups = args[args.length - 1] as Record<
        string,
        string | undefined
      >;
      const letter = groups.p1 ?? groups.p2 ?? groups.p3 ?? groups.p4;
      // 3번 패턴은 대소문자를 가리지 않으면 "a측" 같은 오탐이 생긴다. 대문자만 side로 본다.
      if (
        letter === undefined ||
        (groups.p3 !== undefined && letter !== groups.p3.toUpperCase())
      ) {
        return match;
      }
      return SIDE_PLACEHOLDERS[SIDE_OF_LETTER[letter.toUpperCase()]];
    },
  );
}

// placeholder를 참여자 이름으로 바꾼다. 정규화를 먼저 하므로 레거시 원문(SIDE_A 노출분)도 함께 고쳐진다.
export function renderSideTokens(
  text: string,
  names: Readonly<Record<DebateSide, string>>,
): string {
  let rendered = canonicalizeSideTokens(text);
  for (const side of Object.values(DebateSide)) {
    rendered = rendered.split(SIDE_PLACEHOLDERS[side]).join(names[side]);
  }
  return rendered;
}

/**
 * 정규화한 문장에 placeholder가 아닌 side 흔적이 남아 있으면 그 조각들을 돌려준다(없으면 빈 배열).
 * 쓰는 시점에는 재시도 근거로, 읽는 시점에는 경고 로그 근거로 쓴다.
 */
export function findResidualSideTokens(text: string): string[] {
  let stripped = canonicalizeSideTokens(text);
  for (const placeholder of Object.values(SIDE_PLACEHOLDERS)) {
    stripped = stripped.split(placeholder).join(' ');
  }
  return RESIDUAL_PATTERNS.flatMap((pattern) => stripped.match(pattern) ?? []);
}
