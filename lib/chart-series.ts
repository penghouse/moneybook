import type { FormulaScope } from "@/db/schema";

/**
 * How many series can be on at once.
 *
 * The cap is the palette's, not a layout preference: four steps clear
 * every colour gate in both themes and a fifth could not be found that
 * clears the normal-vision floor against them. A chart cannot draw a
 * series it has no colour for, so the legend refuses the fifth rather
 * than reusing a colour and telling two stories with one line.
 */
export const MAX_SERIES = 4;

/** How many are on before anyone has chosen. */
export const DEFAULT_SERIES = 2;

/**
 * Where the legend's on/off choice is kept.
 *
 * A cookie, read on the server, for the same reason the locale and the
 * theme are: the page then renders with the right series already on and
 * there is no flash of the default selection after hydration. It also
 * means the choice survives 이전 기간 / 다음 기간, which are ordinary
 * navigations — the complaint that prompted this.
 *
 * One per scope, because 자산 and 기간손익 offer different items and a
 * shared list would be half invalid on each screen.
 */
export function seriesCookieName(scope: FormulaScope): string {
  return `chartSeries.${scope}`;
}

/** JSON rather than a delimiter: a 상위 그룹 may be named 「생활비,고정」. */
export function serializeSeries(keys: readonly string[]): string {
  return encodeURIComponent(JSON.stringify(keys.slice(0, MAX_SERIES)));
}

/**
 * The stored choice, or null when there is nothing usable in it.
 *
 * Filtered against what the chart can actually draw, so a category that
 * was renamed or a 계산식 that was deleted drops out instead of leaving
 * a slot pointing at nothing. If that empties the list the caller falls
 * back to the default — a chart that opens blank because of a rename
 * looks broken, and the reader has no way to guess why.
 *
 * Everything here is defensive: the value is user-editable text from a
 * request header, and it may be double-encoded, stale, or nonsense.
 */
export function parseSeries(
  raw: string | undefined,
  available: readonly string[],
): string[] | null {
  if (!raw) return null;

  let text = raw;
  try {
    // Written encoded; whether it arrives that way depends on whether the
    // framework decoded it already, so decoding is attempted and the raw
    // string kept when it does not apply.
    const decoded = decodeURIComponent(raw);
    text = decoded;
  } catch {
    // A malformed escape — fall through with the raw string.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const offered = new Set(available);
  const keys = parsed
    .filter((key): key is string => typeof key === "string")
    .filter((key, i, all) => all.indexOf(key) === i && offered.has(key))
    .slice(0, MAX_SERIES);

  return keys.length > 0 ? keys : null;
}
