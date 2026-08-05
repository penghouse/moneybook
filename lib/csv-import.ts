import {
  ACCOUNT_GROUPS,
  RATE_SOURCES,
  TRANSACTION_KINDS,
  type AccountGroup,
  type RateSource,
  type TransactionKind,
} from "@/db/schema";
import { assertBalanced, type BalanceLineInput } from "./ledger";
import { minorUnitDigits, toMinorUnits } from "./money";
import type { AccountCsvRow, BudgetCsvRow, RateCsvRow, TransactionCsvRow } from "./csv";

/**
 * Pure (no DB access) so the grouping/validation rules governing what a
 * CSV import will accept or reject can be unit tested directly, with the
 * caller (a server action) supplying already-fetched account lookups.
 *
 * Problems are reported as structured codes rather than prose so the UI
 * can render them in the user's language — every other user-facing
 * string in this app goes through the dictionary, and import errors
 * should not be the one English-only surface.
 */
export type ImportIssue =
  | { code: "emptyName" }
  | { code: "invalidGroup"; value: string }
  | { code: "invalidCurrency"; value: string }
  | { code: "duplicateInFile" }
  | { code: "invalidDate"; value: string }
  | { code: "invalidYearMonth"; value: string }
  | { code: "invalidKind"; value: string }
  | { code: "invalidSource"; value: string }
  | { code: "tooFewLines" }
  | { code: "invalidSide"; value: string }
  | { code: "unknownAccount"; value: string }
  | { code: "currencyMismatch"; value: string; expected: string }
  /** `expected` is the group the account is already filed under, localized on display. */
  | { code: "accountGroupMismatch"; value: string; expected: AccountGroup }
  | { code: "ambiguousGroup"; value: string }
  | { code: "activeRange" }
  | { code: "invalidAmount"; value: string }
  | { code: "invalidRate"; value: string }
  | { code: "invalidBaseAmount"; value: string }
  | { code: "unbalanced"; detail: string };

export type ImportIssueCode = ImportIssue["code"];

function isValidCurrency(code: string): boolean {
  try {
    minorUnitDigits(code);
    return true;
  } catch {
    return false;
  }
}

// ---- Accounts ----

export interface AccountRowCheck {
  name: string;
  status: "new" | "existing" | "error";
  issue?: ImportIssue;
  /** Both null unless the row carried a window; blank means unbounded. */
  activeFrom?: string | null;
  activeTo?: string | null;
}

/** Blank is a legitimate value here (unbounded), so only a malformed one is an error. */
function parseOptionalDate(value: string): { date: string | null } | { bad: string } {
  const trimmed = value.trim();
  if (!trimmed) return { date: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { bad: trimmed };
  return { date: trimmed };
}

/**
 * `existingNames` is the fixed snapshot of names already in the DB
 * (rows matching one of these are "existing", not an error).
 * `seenInFile` starts empty and accumulates as the caller processes
 * rows in order — add every accepted row's name to it (new or
 * existing) before checking the next row, so a name repeated within
 * the file itself is flagged as a duplicate on its second occurrence.
 */
export function checkAccountRow(
  row: AccountCsvRow,
  existingNames: ReadonlySet<string>,
  seenInFile: ReadonlySet<string>,
): AccountRowCheck {
  const name = row.name.trim();
  if (!name) return { name, status: "error", issue: { code: "emptyName" } };
  if (!ACCOUNT_GROUPS.includes(row.group as AccountGroup)) {
    return { name, status: "error", issue: { code: "invalidGroup", value: row.group } };
  }
  if (!isValidCurrency(row.currency.trim())) {
    return { name, status: "error", issue: { code: "invalidCurrency", value: row.currency } };
  }
  if (seenInFile.has(name)) {
    return { name, status: "error", issue: { code: "duplicateInFile" } };
  }

  const from = parseOptionalDate(row.activeFrom);
  if ("bad" in from) {
    return { name, status: "error", issue: { code: "invalidDate", value: row.activeFrom } };
  }
  const to = parseOptionalDate(row.activeTo);
  if ("bad" in to) {
    return { name, status: "error", issue: { code: "invalidDate", value: row.activeTo } };
  }
  if (from.date !== null && to.date !== null && from.date > to.date) {
    return { name, status: "error", issue: { code: "activeRange" } };
  }

  return {
    name,
    status: existingNames.has(name) ? "existing" : "new",
    activeFrom: from.date,
    activeTo: to.date,
  };
}

// ---- Transactions ----

export interface TransactionGroup {
  key: string;
  date: string;
  kind: string;
  title: string;
  memo: string;
  lines: TransactionCsvRow[];
}

/** Groups flat CSV rows by transactionKey, preserving first-seen order. */
export function groupTransactionRows(rows: readonly TransactionCsvRow[]): TransactionGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, TransactionGroup>();
  for (const row of rows) {
    const key = row.transactionKey.trim();
    let group = byKey.get(key);
    if (!group) {
      group = { key, date: row.date, kind: row.kind, title: row.title, memo: row.memo, lines: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.lines.push(row);
  }
  return order.map((k) => byKey.get(k)!);
}

export interface ResolvedTransactionLine extends BalanceLineInput {
  accountId: string;
  memo: string | null;
}

export type TransactionGroupCheck =
  | {
      key: string;
      ok: true;
      date: string;
      title: string;
      memo: string;
      kind: TransactionKind;
      lines: ResolvedTransactionLine[];
    }
  | { key: string; ok: false; issue: ImportIssue };

/**
 * Resolves one grouped transaction's lines against a pre-fetched
 * name->account lookup and runs it through the same `assertBalanced`
 * gate every other save path uses — a CSV that doesn't balance is
 * rejected here exactly like a malformed form submission would be.
 */
export function checkTransactionGroup(
  group: TransactionGroup,
  accountsByName: ReadonlyMap<string, { id: string; currency: string }>,
  baseCurrency: string,
): TransactionGroupCheck {
  const fail = (issue: ImportIssue): TransactionGroupCheck => ({
    key: group.key,
    ok: false,
    issue,
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(group.date)) {
    return fail({ code: "invalidDate", value: group.date });
  }
  if (!TRANSACTION_KINDS.includes(group.kind as TransactionKind)) {
    return fail({ code: "invalidKind", value: group.kind });
  }
  if (group.lines.length < 2) {
    return fail({ code: "tooFewLines" });
  }

  const lines: ResolvedTransactionLine[] = [];
  for (const row of group.lines) {
    if (row.side !== "left" && row.side !== "right") {
      return fail({ code: "invalidSide", value: row.side });
    }
    const account = accountsByName.get(row.account.trim());
    if (!account) {
      return fail({ code: "unknownAccount", value: row.account });
    }
    if (account.currency !== row.currency.trim().toUpperCase()) {
      return fail({
        code: "currencyMismatch",
        value: row.account,
        expected: account.currency,
      });
    }

    const amountMajor = row.amount.trim() === "" ? 0 : Number(row.amount);
    if (!Number.isFinite(amountMajor) || amountMajor < 0) {
      return fail({ code: "invalidAmount", value: row.amount });
    }
    const amount = toMinorUnits(amountMajor, account.currency);

    const rateStr = row.rate.trim();
    const rate = rateStr === "" ? null : Number(rateStr);
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
      return fail({ code: "invalidRate", value: row.rate });
    }

    const baseAmountMajor = Number(row.baseAmount);
    if (!Number.isFinite(baseAmountMajor) || baseAmountMajor < 0) {
      return fail({ code: "invalidBaseAmount", value: row.baseAmount });
    }
    const baseAmount = toMinorUnits(baseAmountMajor, baseCurrency);

    lines.push({
      side: row.side,
      accountId: account.id,
      currency: account.currency,
      amount,
      rate,
      baseAmount,
      memo: row.lineMemo.trim() || null,
    });
  }

  try {
    assertBalanced(lines, baseCurrency, group.kind as TransactionKind);
  } catch (error) {
    return fail({ code: "unbalanced", detail: error instanceof Error ? error.message : "" });
  }

  return {
    key: group.key,
    ok: true,
    date: group.date,
    title: group.title.trim(),
    memo: group.memo.trim(),
    kind: group.kind as TransactionKind,
    lines,
  };
}

// ---- Budgets ----

export type BudgetRowCheck =
  | { ok: true; accountId: string; yearMonth: string; amountMajor: number }
  | { ok: false; label: string; issue: ImportIssue };

export function checkBudgetRow(
  row: BudgetCsvRow,
  accountsByName: ReadonlyMap<string, { id: string; currency: string }>,
): BudgetRowCheck {
  const label = `${row.account} ${row.yearMonth}`.trim();
  const account = accountsByName.get(row.account.trim());
  if (!account) {
    return { ok: false, label, issue: { code: "unknownAccount", value: row.account } };
  }
  if (!/^\d{4}-\d{2}$/.test(row.yearMonth.trim())) {
    return { ok: false, label, issue: { code: "invalidYearMonth", value: row.yearMonth } };
  }
  const amountMajor = Number(row.amount);
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    return { ok: false, label, issue: { code: "invalidAmount", value: row.amount } };
  }
  return { ok: true, accountId: account.id, yearMonth: row.yearMonth.trim(), amountMajor };
}

// ---- Exchange rates ----

export type RateRowCheck =
  | { ok: true; date: string; base: string; quote: string; rate: number; source: RateSource }
  | { ok: false; label: string; issue: ImportIssue };

export function checkRateRow(row: RateCsvRow): RateRowCheck {
  const label = `${row.date} ${row.base}/${row.quote}`.trim();
  const date = row.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, label, issue: { code: "invalidDate", value: row.date } };
  }
  const base = row.base.trim().toUpperCase();
  const quote = row.quote.trim().toUpperCase();
  for (const code of [base, quote]) {
    if (!isValidCurrency(code)) {
      return { ok: false, label, issue: { code: "invalidCurrency", value: code } };
    }
  }
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, label, issue: { code: "invalidRate", value: row.rate } };
  }
  const source = row.source.trim();
  if (!RATE_SOURCES.includes(source as RateSource)) {
    return { ok: false, label, issue: { code: "invalidSource", value: row.source } };
  }
  return { ok: true, date, base, quote, rate, source: source as RateSource };
}
