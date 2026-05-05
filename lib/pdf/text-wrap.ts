/**
 * 한/영 혼합 텍스트 줄바꿈.
 *
 *   - 1차: 명시 개행(`\n`) 으로 split.
 *   - 2차: 영문/숫자/공백 으로 토큰화한 단어 단위 wrap.
 *   - 3차: 영문 단어 하나가 max 폭을 넘기거나 한글 단어가 있으면 grapheme 단위 fallback.
 *
 * 측정은 caller 가 넘기는 `measure(text) -> px` 로 한다 (CanvasRenderingContext2D.measureText 사용 가정).
 */

export interface WrapOptions {
  /** 측정 함수 — 통상 `(s) => ctx.measureText(s).width`. */
  measure: (s: string) => number;
  /** 최대 폭(px). 초과 시 줄바꿈. */
  maxWidthPx: number;
}

/**
 * @returns 라인 배열 (빈 문자열 = 빈 줄).
 */
export function wrapMixedText(text: string, opts: WrapOptions): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para.length === 0) {
      lines.push("");
      continue;
    }
    lines.push(...wrapSingleLine(para, opts));
  }
  return lines;
}

function wrapSingleLine(text: string, opts: WrapOptions): string[] {
  const { measure, maxWidthPx } = opts;
  if (measure(text) <= maxWidthPx) return [text];

  const tokens = tokenize(text);
  const out: string[] = [];
  let cur = "";

  const pushCur = () => {
    if (cur.length > 0) out.push(cur);
    cur = "";
  };

  for (const tok of tokens) {
    if (tok === "") continue;
    const candidate = cur + tok;
    if (measure(candidate) <= maxWidthPx) {
      cur = candidate;
      continue;
    }

    // 1) cur 가 비어있지 않으면 현재까지 push 하고 tok 새 줄로
    if (cur.length > 0) {
      pushCur();
      // 새 줄 시작 시 선행 공백은 제거
      const trimmed = tok.replace(/^\s+/, "");
      if (measure(trimmed) <= maxWidthPx) {
        cur = trimmed;
        continue;
      }
      // 한 토큰이 max 보다 길면 grapheme split
      out.push(...graphemeSplit(trimmed, measure, maxWidthPx));
      cur = "";
      continue;
    }

    // 2) cur 가 비었는데도 tok 자체가 max 초과 → grapheme split
    out.push(...graphemeSplit(tok, measure, maxWidthPx));
  }

  pushCur();
  return out.length > 0 ? out : [""];
}

/**
 * 토큰화: 라틴 단어/숫자/공백/기타(=한글 등)을 분리.
 * 한글/CJK/이모지 등은 1글자(grapheme) 단위로 토큰이 된다.
 *
 * 예: "안녕 hello world" → ["안", "녕", " ", "hello", " ", "world"]
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[A-Za-z0-9]+|\s+|[\p{L}\p{Mark}\p{Emoji}]|./gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/** grapheme 단위로 잘라가며 max 폭 안에 들어가도록 줄을 만든다. */
function graphemeSplit(
  text: string,
  measure: (s: string) => number,
  maxWidthPx: number,
): string[] {
  const out: string[] = [];
  let cur = "";
  // Array.from 으로 grapheme 가까운 분리 (서로게이트 페어 안전)
  for (const ch of Array.from(text)) {
    const candidate = cur + ch;
    if (measure(candidate) <= maxWidthPx || cur.length === 0) {
      cur = candidate;
    } else {
      out.push(cur);
      cur = ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
