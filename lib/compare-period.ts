import { addYearsToDate, shiftWindow } from "./date";

/** What the period on screen is being held up against. */
export const COMPARE_BASELINES = ["previous", "year1", "year2", "year3", "year4", "year5"] as const;
export type CompareBaseline = (typeof COMPARE_BASELINES)[number];

export const DEFAULT_BASELINE: CompareBaseline = "previous";

export function parseBaseline(value: string | undefined): CompareBaseline {
  return COMPARE_BASELINES.includes(value as CompareBaseline)
    ? (value as CompareBaseline)
    : DEFAULT_BASELINE;
}

/** Which accounts the comparison is over. */
export const COMPARE_SCOPES = ["flow", "balance"] as const;
export type CompareScope = (typeof COMPARE_SCOPES)[number];

export function parseScope(value: string | undefined): CompareScope {
  return COMPARE_SCOPES.includes(value as CompareScope) ? (value as CompareScope) : "flow";
}

/**
 * The range the current one is measured against.
 *
 * Two different questions, and the difference matters:
 *
 * - **직전기간** is the window immediately before this one, however long
 *   it happens to be. Twelve months back from twelve months is the
 *   twelve before; a fortnight back from a fortnight is the fortnight
 *   before. This is the reading for "is it going up".
 * - **N년 전** is the same dates in an earlier year. This is the reading
 *   for "how does this September compare with last September", which a
 *   window-length shift cannot answer at all: 이사, 명절, 보험료 land on
 *   the calendar, not on a rolling window.
 *
 * A leap day shifted into a year that has none lands on the 28th, which
 * is what `addYearsToDate` already does for the balance sheet's arrows.
 */
export function baselineRange(
  from: string,
  to: string,
  baseline: CompareBaseline,
): { from: string; to: string } {
  if (baseline === "previous") return shiftWindow(from, to, -1);
  const years = Number(baseline.slice(4));
  return { from: addYearsToDate(from, -years), to: addYearsToDate(to, -years) };
}
