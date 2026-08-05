// 초성(choseong) search: typing "ㅅㅂ" should find "식비". Complete
// Korean syllables in Unicode are laid out as a single contiguous block
// (가=0xAC00 .. 힣=0xD7A3), decomposed as
// initial*(21*28) + medial*28 + final + 0xAC00, so the initial consonant
// of any syllable is recoverable by integer arithmetic alone.

const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

const CHOSEONG_SET = new Set<string>(CHOSEONG);
const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
const SYLLABLES_PER_INITIAL = 21 * 28;

function getChoseong(char: string): string | null {
  const code = char.charCodeAt(0);
  if (code < SYLLABLE_START || code > SYLLABLE_END) return null;
  const index = Math.floor((code - SYLLABLE_START) / SYLLABLES_PER_INITIAL);
  return CHOSEONG[index];
}

export function toChoseongString(text: string): string {
  return [...text].map((ch) => getChoseong(ch) ?? ch).join("");
}

export function isAllChoseong(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => CHOSEONG_SET.has(ch));
}

/** Substring match, or choseong match when the query is all initials. */
export function matchesQuery(target: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (target.toLowerCase().includes(q)) return true;
  return isAllChoseong(query) && toChoseongString(target).includes(query);
}
