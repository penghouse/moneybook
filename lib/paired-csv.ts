import type { AccountGroup } from "@/db/schema";
import { CsvFormatError, parseCsv } from "./csv";
import type { ImportIssue } from "./csv-import";
import { assertBalanced } from "./ledger";
import { toMinorUnits } from "./money";

/**
 * Reading a CSV that carries a whole transaction on every row, so a
 * ledger kept in another app can be moved here without hand-editing
 * thousands of rows into this app's format first.
 *
 * The shape is different enough from `transactions.csv` to need its own
 * reader rather than a header alias. Each row holds **one complete
 * transaction**, with both sides already on it:
 *
 *     날짜,아이템,금액,기간내합계,왼쪽,,오른쪽,,메모
 *     2026-08-03,이자,333333,1000000,자산,예금,수익,금융수익,
 *
 * Two of the nine columns have blank names — they hold the account for
 * the 왼쪽/오른쪽 group named in the column before. This app's own
 * format instead writes one row per *journal line*, keyed by
 * `transactionKey`, so one row there becomes two lines here.
 *
 * Three things this reader decides, which the file does not say:
 *
 * - **`기간내합계` is dropped.** It is a running total over whatever
 *   period was exported, so it is only correct for that one export;
 *   balances here are always recomputed from the lines themselves.
 * - **Everything is the section's base currency.** The format has no
 *   currency column, so an amount is taken at face value in the base
 *   currency and every line gets `rate = 1`.
 * - **Nothing becomes an `opening` transaction.** The 순자산 group is
 *   where such a file posts its opening balances, but it is a *group*,
 *   not a transaction kind — a book that posts real equity movements
 *   there would be mislabelled by guessing. The rows still import, as
 *   ordinary transactions against an equity account, and carry the same
 *   balances.
 */

/**
 * The header row, verbatim. The two empty names are the source file's,
 * not a transcription slip: the 왼쪽/오른쪽 headings span two columns each
 * (group, then account) and only the first of the pair is named.
 */
export const PAIRED_CSV_COLUMNS = [
  "날짜",
  "아이템",
  "금액",
  "기간내합계",
  "왼쪽",
  "",
  "오른쪽",
  "",
  "메모",
] as const;

/**
 * The five group names such a file uses. 순자산 is where it posts
 * opening balances and it behaves as equity does here, so both labels
 * map to the same group — 자본 is accepted too, since that is the word
 * this app itself shows for it.
 */
const GROUP_BY_LABEL: Readonly<Record<string, AccountGroup>> = {
  자산: "asset",
  부채: "liability",
  순자산: "equity",
  자본: "equity",
  비용: "expense",
  수익: "income",
};

export interface PairedRow {
  /** 1-based line number in the file, so an error can name the row. */
  line: number;
  date: string;
  item: string;
  amount: string;
  leftGroup: string;
  leftAccount: string;
  rightGroup: string;
  rightAccount: string;
  memo: string;
}

export function parsePairedCsv(text: string): PairedRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const matchesHeader =
    header.length === PAIRED_CSV_COLUMNS.length &&
    PAIRED_CSV_COLUMNS.every((col, i) => header[i] === col);
  if (!matchesHeader) {
    throw new CsvFormatError(`header_mismatch:${PAIRED_CSV_COLUMNS.join(",")}`);
  }

  return rows.slice(1).map((cols, i) => {
    if (cols.length !== PAIRED_CSV_COLUMNS.length) {
      throw new CsvFormatError(`column_count:${i + 2}:${PAIRED_CSV_COLUMNS.length}:${cols.length}`);
    }
    return {
      line: i + 2,
      date: cols[0],
      item: cols[1],
      amount: cols[2],
      // cols[3] is 기간내합계 — a running total, deliberately unread.
      leftGroup: cols[4],
      leftAccount: cols[5],
      rightGroup: cols[6],
      rightAccount: cols[7],
      memo: cols[8],
    };
  });
}

/** An account as the file names it: this app matches on name, not id. */
export interface PairedAccountRef {
  group: AccountGroup;
  name: string;
}

export type PairedRowCheck =
  | {
      ok: true;
      line: number;
      date: string;
      title: string;
      memo: string;
      /** Base-currency minor units, always >= 0. */
      amount: number;
      left: PairedAccountRef;
      right: PairedAccountRef;
    }
  | { ok: false; line: number; issue: ImportIssue };

function toRef(
  groupLabel: string,
  accountName: string,
): { ref: PairedAccountRef } | { issue: ImportIssue } {
  const group = GROUP_BY_LABEL[groupLabel.trim()];
  if (!group) return { issue: { code: "invalidGroup", value: groupLabel } };
  const name = accountName.trim();
  if (!name) return { issue: { code: "emptyName" } };
  return { ref: { group, name } };
}

/**
 * One paired row → one balanced two-line transaction, or the reason it
 * cannot be one. Pure, so the rules are unit-testable without a database;
 * the caller resolves the returned account *names* against the section.
 *
 * A **negative 금액** is the format's shorthand for the entry running
 * the other way — points earned against a spending category, a stock loss
 * against an investment account. This app stores direction in `side` and
 * forbids a negative `amount` outright, so the sign is folded into the
 * sides: the two accounts swap and the magnitude is kept. That is the
 * same journal entry, not an approximation of it — 607 of the 8,719 rows
 * in the export this was written against are negative, so dropping them
 * was never an option.
 */
export function checkPairedRow(row: PairedRow, baseCurrency: string): PairedRowCheck {
  const fail = (issue: ImportIssue): PairedRowCheck => ({ ok: false, line: row.line, issue });

  const date = row.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail({ code: "invalidDate", value: row.date });
  }

  const left = toRef(row.leftGroup, row.leftAccount);
  if ("issue" in left) return fail(left.issue);
  const right = toRef(row.rightGroup, row.rightAccount);
  if ("issue" in right) return fail(right.issue);

  const value = Number(row.amount.trim());
  if (row.amount.trim() === "" || !Number.isFinite(value)) {
    return fail({ code: "invalidAmount", value: row.amount });
  }
  const amount = toMinorUnits(Math.abs(value), baseCurrency);
  const reversed = value < 0;

  // Balanced by construction — but this is the gate every save path in
  // this app goes through, and an import that wrote rows around it would
  // be the one way unbalanced lines could reach the database.
  const line = { currency: baseCurrency, amount, rate: 1, baseAmount: amount };
  try {
    assertBalanced(
      [
        { ...line, side: "left" },
        { ...line, side: "right" },
      ],
      baseCurrency,
    );
  } catch (error) {
    return fail({ code: "unbalanced", detail: error instanceof Error ? error.message : "" });
  }

  return {
    ok: true,
    line: row.line,
    date,
    title: row.item.trim(),
    memo: row.memo.trim(),
    amount,
    left: reversed ? right.ref : left.ref,
    right: reversed ? left.ref : right.ref,
  };
}

export interface ExistingAccount {
  id: string;
  group: AccountGroup;
  currency: string;
}

export type PairedAccountPlan =
  | { name: string; status: "existing"; id: string }
  | { name: string; status: "new"; group: AccountGroup }
  | { name: string; status: "conflict"; issue: ImportIssue };

/**
 * What has to happen to the chart of accounts before these rows can be
 * written: one entry per distinct name, in first-seen order.
 *
 * The file carries only names, so an account already in the book is
 * reused rather than duplicated — but only where it agrees with the
 * file. Three ways it might not, each reported once against the account
 * rather than once per row that mentions it:
 *
 * - the file uses one name under two groups, so there is no single
 *   account to create (an account name is unique within a book);
 * - the book already has that name under a different group;
 * - the book already has it in a currency other than the base one, where
 *   a bare paired amount cannot be read at face value.
 *
 * The caller drops every row touching such a name. Nothing here is
 * guessed: with 8,700 rows riding on it, silently filing an account
 * under the wrong group would be much more expensive to notice than to
 * be told about.
 */
export function planPairedAccounts(
  refs: readonly PairedAccountRef[],
  existing: ReadonlyMap<string, ExistingAccount>,
  baseCurrency: string,
): PairedAccountPlan[] {
  const groupByName = new Map<string, AccountGroup>();
  const order: string[] = [];
  const ambiguous = new Set<string>();

  for (const ref of refs) {
    const seen = groupByName.get(ref.name);
    if (seen === undefined) {
      groupByName.set(ref.name, ref.group);
      order.push(ref.name);
    } else if (seen !== ref.group) {
      ambiguous.add(ref.name);
    }
  }

  return order.map((name): PairedAccountPlan => {
    const group = groupByName.get(name)!;
    if (ambiguous.has(name)) {
      return { name, status: "conflict", issue: { code: "ambiguousGroup", value: name } };
    }

    const account = existing.get(name);
    if (!account) return { name, status: "new", group };
    if (account.group !== group) {
      return {
        name,
        status: "conflict",
        issue: { code: "accountGroupMismatch", value: name, expected: account.group },
      };
    }
    if (account.currency !== baseCurrency) {
      return {
        name,
        status: "conflict",
        issue: { code: "currencyMismatch", value: name, expected: account.currency },
      };
    }
    return { name, status: "existing", id: account.id };
  });
}
