/** Whether the 자주 쓰는 항목 row is folded away. */
export const QUICK_COLLAPSED_COOKIE = "quick.collapsed";

/** Which chips the reader has put away, and for which month. */
export const QUICK_HIDDEN_COOKIE = "quick.hidden";

/** A guard on the header, not a real limit. */
const MAX_HIDDEN = 32;

/**
 * The chips put away this month, and nothing from any other.
 *
 * Hiding is a statement about *this* month — 「이번 달엔 안 쓸 것 같다」 —
 * so it expires with the month rather than needing to be undone. A
 * cancelled subscription drops off the row by itself after two quiet
 * months (see quick-entries); this is for the one you know about now.
 *
 * The month is stored alongside so expiry needs no clock of its own: a
 * list stamped with a month that is no longer the month simply does not
 * apply, and the next read is the one that notices.
 */
export function serializeHidden(month: string, titles: readonly string[]): string {
  return encodeURIComponent(JSON.stringify({ month, titles: titles.slice(0, MAX_HIDDEN) }));
}

/**
 * Everything here is defensive: the value is user-editable text from a
 * request header, and it may be double-encoded, stale, or nonsense.
 */
export function parseHidden(raw: string | undefined, currentMonth: string): string[] {
  if (!raw) return [];

  let text = raw;
  try {
    // Written encoded; whether it arrives that way depends on whether
    // the framework decoded it already, so decoding is attempted and the
    // raw string kept when it does not apply.
    text = decodeURIComponent(raw);
  } catch {
    // A malformed escape — fall through with the raw string.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];

  const { month, titles } = parsed as { month?: unknown; titles?: unknown };
  if (month !== currentMonth || !Array.isArray(titles)) return [];

  return titles
    .filter((title): title is string => typeof title === "string")
    .filter((title, i, all) => all.indexOf(title) === i)
    .slice(0, MAX_HIDDEN);
}
