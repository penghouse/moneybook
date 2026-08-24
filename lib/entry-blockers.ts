import { isActiveOn, type ActiveWindow } from "./accounts";

/**
 * Why 저장 cannot be pressed yet.
 *
 * The button knew perfectly well — it was `disabled={!isBalanced}` — and
 * said none of it. A form that looks filled in with a dead button reads
 * as a broken app, and two of these are invisible: a foreign-currency
 * leg whose rate never arrived shows an amount and still totals nothing,
 * and an account typed but never picked from the list leaves an empty id
 * behind a box with a name in it.
 *
 * Ordered by what the reader should fix first. Only the first is shown —
 * a list of five faults on a two-line form is worse than one instruction.
 */
export type EntryBlocker =
  | { kind: "account" }
  | { kind: "amount" }
  | { kind: "rate"; currency: string }
  | { kind: "inactive"; name: string }
  | { kind: "unbalanced" };

export interface BlockerLine {
  accountId: string;
  /** The account's own currency, empty until one is picked. */
  currency: string;
  /** As typed, so '' means the box is empty rather than zero. */
  amountStr: string;
  /** Null until a rate is known. Irrelevant in the base currency. */
  rate: number | null;
}

/**
 * The one thing standing between this form and a save, or null when
 * nothing is.
 *
 * `balanced` is passed in rather than recomputed: the form already works
 * the two side totals out for the band above the button, and a second
 * implementation of the same arithmetic is a second chance to disagree
 * with it.
 */
export function findEntryBlocker(params: {
  lines: readonly BlockerLine[];
  baseCurrency: string;
  /** The transaction's date, which is what the accounts have to be open on. */
  date: string;
  /** Active window per account id. Missing means "no window", i.e. always open. */
  windowsByAccountId: ReadonlyMap<string, ActiveWindow>;
  /** What the form's own side totals say. */
  balanced: boolean;
  nameOf: (accountId: string) => string;
}): EntryBlocker | null {
  const { lines, baseCurrency, date, windowsByAccountId, balanced, nameOf } = params;

  if (lines.some((line) => !line.accountId)) return { kind: "account" };
  if (lines.some((line) => !line.amountStr)) return { kind: "amount" };

  for (const line of lines) {
    const window = windowsByAccountId.get(line.accountId);
    // An account is offered by the picker for *today*, while the date on
    // the form can be any day — so backdating an entry onto a card that
    // had not opened yet passes every other check and is refused by the
    // server. Caught here, where the fix is one field away.
    if (window && !isActiveOn(window, date)) {
      return { kind: "inactive", name: nameOf(line.accountId) };
    }
  }

  for (const line of lines) {
    if (line.currency && line.currency !== baseCurrency && line.rate === null) {
      return { kind: "rate", currency: line.currency };
    }
  }

  return balanced ? null : { kind: "unbalanced" };
}
