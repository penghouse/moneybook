import { and, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { accounts, type AccountGroup } from "@/db/schema";

/**
 * When an account counts as in use.
 *
 * This app has two kinds of account list and they must not be filtered
 * the same way:
 *
 * - **The catalog** — "which accounts exist": the entry form's picker,
 *   the budget rows, the accounts page. A dimension. This is what the
 *   active window governs.
 * - **Derived facts** — "what is the balance / what moved": everything
 *   built from `transaction_lines` by `lib/ledger.ts`. A balance is a
 *   *level*, so a deposit account with no transactions this year still
 *   holds its money and still belongs on the balance sheet. Filtering
 *   those by the window would drop real money out of a total.
 *
 * So: the window filters the catalog and nothing else. `/assets` and
 * `/income` never call anything in this file.
 *
 * The rule lived inline as `eq(accounts.isArchived, false)` in two page
 * components. As an interval it is four comparisons with two nullable
 * ends, which is exactly the kind of thing that ends up subtly different
 * in each copy — so it is written once, here, and pinned by unit tests.
 */

export interface ActiveWindow {
  activeFrom: string | null;
  activeTo: string | null;
}

/** Null on either end means unbounded, so an account with neither is always active. */
export function isActiveOn(account: ActiveWindow, date: string): boolean {
  if (account.activeFrom !== null && date < account.activeFrom) return false;
  if (account.activeTo !== null && date > account.activeTo) return false;
  return true;
}

/**
 * Whether the account was in use at any point in [from, to] — standard
 * interval overlap, not containment. A card closed mid-month belongs on
 * that month's budget: it was spent from.
 */
export function isActiveDuring(account: ActiveWindow, from: string, to: string): boolean {
  if (account.activeFrom !== null && account.activeFrom > to) return false;
  if (account.activeTo !== null && account.activeTo < from) return false;
  return true;
}

/** Closed strictly before `date`, i.e. gone rather than merely not-yet-open. */
export function isClosedBy(account: ActiveWindow, date: string): boolean {
  return account.activeTo !== null && account.activeTo < date;
}

/** The `isActiveOn` predicate, for filtering in the database. */
export function activeOn(date: string): SQL {
  return and(
    or(isNull(accounts.activeFrom), lte(accounts.activeFrom, date)),
    or(isNull(accounts.activeTo), gte(accounts.activeTo, date)),
  )!;
}

/** The `isActiveDuring` predicate, for filtering in the database. */
export function activeDuring(from: string, to: string): SQL {
  return and(
    or(isNull(accounts.activeFrom), lte(accounts.activeFrom, to)),
    or(isNull(accounts.activeTo), gte(accounts.activeTo, from)),
  )!;
}

/**
 * Whether the group carries flows rather than levels.
 *
 * 식비 has no balance — it has a total, and only ever within some period.
 * Assets and liabilities are the other way round: their balance carries
 * forward and a period cannot bound it. Screens that report "the number
 * standing for this account" have to ask which of the two they are
 * looking at.
 */
export function isFlowGroup(group: AccountGroup): boolean {
  return group === "income" || group === "expense";
}

/**
 * Which groups can keep a counterparty breakdown.
 *
 * A counterparty balance is money still outstanding with someone — a
 * level, which only asset and liability accounts have. Income and
 * expense accounts carry flows, and "지금까지 식비 거래처별 잔액" is not a
 * question with an answer.
 *
 * This would be a CHECK if SQLite could attach one to a column added by
 * ALTER TABLE. It cannot, and the table rebuild that would be needed
 * instead has to drop `accounts` while two tables reference it — so the
 * rule lives here, and both write paths call it.
 */
export function canTrackCounterparties(group: AccountGroup): boolean {
  return !isFlowGroup(group);
}
