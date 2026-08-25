/**
 * The query layer: every figure the reports show is worked out here, and
 * the sign convention they all share lives in ./normal-balance.
 *
 * Split by what a caller is asking for rather than by table:
 *
 * - `account-nets`  一 account totals as a level (`asOf`) or a flow (`from`–`to`)
 * - `monthly`       一 the same figures across a window of months, for charts
 * - `periods`       一 income and expense totalled per month or per year
 * - `running`       一 the balance standing after each transaction in a list
 * - `titles`        一 grouped by 적요: counterparty balances and entry suggestions
 * - `tagged`        一 transactions carrying a #tag
 * - `fx`            一 unrealized gain on foreign-currency holdings
 * - `assert-balanced` 一 the double-entry invariant, checked before a write
 *
 * Re-exported here so callers keep importing "@/lib/ledger" and need not
 * know which of the eight a function happens to live in.
 */
export {
  assertBalanced,
  UnbalancedTransactionError,
  type BalanceLineInput,
} from "./assert-balanced";
export { getAccountBalances, getAccountFlows, type AccountBalance } from "./account-nets";
export {
  getMonthlyAccountAmounts,
  getMonthlyBalanceSheet,
  type MonthlyBalanceSheet,
} from "./monthly";
export { getPeriodTotals, type PeriodTotal } from "./periods";
export { getQuickEntries } from "./quick";
export { getRunningBalances, type RunningBalance } from "./running";
export {
  getTitleSuggestions,
  getTitleTotals,
  type TitleSuggestion,
  type TitleTotal,
} from "./titles";
export { findTaggedTransactionIds } from "./tagged";
export { getUnrealizedFx, type ResolvedUnrealizedFx, type UnrealizedFx } from "./fx";
