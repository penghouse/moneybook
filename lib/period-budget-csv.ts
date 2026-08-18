import type { AccountGroup } from "@/db/schema";
import { CsvFormatError, parseCsv } from "./csv";
import type { ImportIssue } from "./csv-import";
import { monthRange, yearRange } from "./date";
import { toMinorUnits } from "./money";

/**
 * Reading a budget-vs-actual report exported from another ledger app, so
 * a year of budgets can be moved here without retyping one figure per
 * account per month.
 *
 * Each row is one line of that report:
 *
 *     시작일,종료일,계정,항목,예산,금액,잔여액
 *     2026-01-01,2026-01-31,비용,식비,470000,510000,-40000
 *
 * Only 예산 is read. 금액 and 잔여액 are the period's spend and what was
 * left of the plan — both already derivable from the transactions this
 * app holds, and both wrong the moment one of them is edited, so taking
 * them in would plant a second, stale answer beside the live one.
 *
 * The period is the 시작일–종료일 pair rather than a key: a whole month
 * becomes '2026-01' and a whole year '2026', which are exactly the two
 * shapes a budget is kept in here. A range that is neither is refused
 * rather than rounded to the month it mostly covers.
 *
 * **The file mixes totals in with the items.** Between the account rows
 * sit its running sums — 총, and one per 상위 그룹 — and no column says
 * which is which. So the rule is: a row is imported when its 항목 names
 * an account this book actually keeps, in the group the row claims.
 * Every other row is skipped and named in the preview, so a subtotal
 * quietly landing on an account is something you would see rather than
 * discover months later.
 */

/** The header row, verbatim. */
export const PERIOD_BUDGET_CSV_COLUMNS = [
  "시작일",
  "종료일",
  "계정",
  "항목",
  "예산",
  "금액",
  "잔여액",
] as const;

/**
 * Only the two groups a budget can belong to. A file that also lists
 * 자산 or 부채 rows is not malformed — those reports exist — so such
 * rows are skipped rather than failing the import.
 */
const GROUP_BY_LABEL: Readonly<Record<string, Extract<AccountGroup, "income" | "expense">>> = {
  비용: "expense",
  수익: "income",
};

export interface PeriodBudgetRow {
  /** 1-based line number in the file, so an error can name the row. */
  line: number;
  from: string;
  to: string;
  group: string;
  item: string;
  budget: string;
}

export function parsePeriodBudgetCsv(text: string): PeriodBudgetRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const matchesHeader =
    header.length === PERIOD_BUDGET_CSV_COLUMNS.length &&
    PERIOD_BUDGET_CSV_COLUMNS.every((col, i) => header[i] === col);
  if (!matchesHeader) {
    throw new CsvFormatError(`header_mismatch:${PERIOD_BUDGET_CSV_COLUMNS.join(",")}`);
  }

  return rows.slice(1).map((cols, i) => {
    if (cols.length !== PERIOD_BUDGET_CSV_COLUMNS.length) {
      throw new CsvFormatError(
        `column_count:${i + 2}:${PERIOD_BUDGET_CSV_COLUMNS.length}:${cols.length}`,
      );
    }
    return {
      line: i + 2,
      from: cols[0].trim(),
      to: cols[1].trim(),
      group: cols[2].trim(),
      item: cols[3].trim(),
      budget: cols[4].trim(),
    };
  });
}

/**
 * '2026-01-01'–'2026-01-31' is a month, '2026-01-01'–'2026-12-31' a
 * year, and anything else is neither.
 *
 * Both ends are compared against `monthRange`/`yearRange` rather than
 * against a rule written again here, so February lands on the 28th or
 * the 29th as its own year decides and there is one answer in the
 * codebase to what a whole month is.
 */
export function periodKeyOf(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;

  const yearMonth = from.slice(0, 7);
  const month = monthRange(yearMonth);
  if (from === month.from && to === month.to) return yearMonth;

  const year = yearRange(from.slice(0, 4));
  if (from === year.from && to === year.to) return from.slice(0, 4);

  return null;
}

/**
 * The format's own subtotal headings — 총, and 총 followed by whichever
 * split the book uses. Matched as a whole word so an account called
 * 총무비 is not swept up with them.
 */
function isTotalRow(item: string): boolean {
  return item === "총" || item.startsWith("총 ");
}

export type PeriodBudgetRowCheck =
  | { ok: true; line: number; accountId: string; periodKey: string; amount: number }
  /** Not an error: a subtotal, another group's report, or an account this book does not keep. */
  | { ok: false; line: number; skipped: true; item: string }
  | { ok: false; line: number; skipped: false; label: string; issue: ImportIssue };

export function checkPeriodBudgetRow(
  row: PeriodBudgetRow,
  baseCurrency: string,
  /** Account id by `${group} ${name}`, so a 비용 row cannot land on a 수익 account. */
  accountsByGroupAndName: ReadonlyMap<string, string>,
): PeriodBudgetRowCheck {
  const group = GROUP_BY_LABEL[row.group];
  if (!group || !row.item || isTotalRow(row.item)) {
    return { ok: false, line: row.line, skipped: true, item: row.item };
  }

  const accountId = accountsByGroupAndName.get(`${group} ${row.item}`);
  if (!accountId) {
    return { ok: false, line: row.line, skipped: true, item: row.item };
  }

  // Past here the row *is* about an account this book keeps, so anything
  // still wrong with it is a real problem worth reporting rather than a
  // line to pass over in silence.
  const label = `${row.item} ${row.from}`.trim();
  const periodKey = periodKeyOf(row.from, row.to);
  if (!periodKey) {
    return {
      ok: false,
      line: row.line,
      skipped: false,
      label,
      issue: { code: "invalidPeriod", value: `${row.from}~${row.to}` },
    };
  }

  const amountMajor = Number(row.budget);
  if (row.budget === "" || !Number.isFinite(amountMajor) || amountMajor < 0) {
    return {
      ok: false,
      line: row.line,
      skipped: false,
      label,
      issue: { code: "invalidAmount", value: row.budget },
    };
  }

  return {
    ok: true,
    line: row.line,
    accountId,
    periodKey,
    amount: toMinorUnits(amountMajor, baseCurrency),
  };
}
