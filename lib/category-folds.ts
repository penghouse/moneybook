/** The screens that group their rows under 상위 그룹 bands. */
export const FOLD_SCOPES = ["assets", "income", "budget"] as const;
export type FoldScope = (typeof FOLD_SCOPES)[number];

/**
 * Where the folded-away 상위 그룹 are remembered.
 *
 * A cookie, read on the server, for the same reason the chart legend's
 * choice is: the page renders already folded rather than flashing the
 * full list and collapsing after hydration. It also means the folds
 * survive 이전 달 / 다음 달 and 기준일 — those are ordinary navigations,
 * and a list that unfolded itself on every step would be worse than not
 * folding at all.
 *
 * One per screen. 자산현황 groups 자산·부채 accounts and 예산 groups
 * 수입·지출 ones, so a shared list would be mostly inapplicable on each,
 * and folding 투자 on the balance sheet has nothing to say about the
 * budget.
 */
export function foldCookieName(scope: FoldScope): string {
  return `folds.${scope}`;
}

/**
 * What the 미분류 bucket is called in the cookie.
 *
 * A real 상위 그룹 name cannot hold a NUL, so this cannot collide with
 * one — and the bucket has to be foldable like any other band.
 */
export const UNCATEGORIZED_FOLD = "\u0000uncategorized";

/** How many names are kept. A guard on the header, not a real limit. */
const MAX_FOLDS = 64;

/** JSON rather than a delimiter: a 상위 그룹 may be named 「생활비,고정」. */
export function serializeFolds(names: readonly string[]): string {
  return encodeURIComponent(JSON.stringify(names.slice(0, MAX_FOLDS)));
}

/**
 * The folded names, or an empty list when there is nothing usable.
 *
 * Everything here is defensive: the value is user-editable text from a
 * request header, and it may be double-encoded, stale, or nonsense. A
 * name that no longer exists is harmless — nothing matches it — so
 * unlike the chart legend this does not need the caller to say what is
 * available.
 */
export function parseFolds(raw: string | undefined): string[] {
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
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((name): name is string => typeof name === "string")
    .filter((name, i, all) => all.indexOf(name) === i)
    .slice(0, MAX_FOLDS);
}
