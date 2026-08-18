import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { accounts, budgets } from "@/db/schema";
import type { Db } from "@/db/types";
import { getPeriodTotals } from "./ledger";

/**
 * What went into savings in one month, and where the figure came from.
 *
 * 저축 is 수입 − 지출: the money that stayed. In double entry that is
 * also the month's change in equity, which is why the roadmap can add
 * it to an opening balance and get a closing one.
 */
export interface MonthlySaving {
  /** 'YYYY-MM'. */
  month: string;
  income: number;
  expense: number;
  /** income − expense. Negative months are real and are kept. */
  saving: number;
  /**
   * 'actual' for a month that has already happened, 'budget' for one
   * that has not. The current month counts as budget: it is not over,
   * and its half-finished total would read as a bad month rather than
   * an unfinished one.
   */
  source: "actual" | "budget";
  /**
   * Nothing spoke for this month — it is before the book begins, or it
   * is ahead of us with no budget set. Told apart from a genuine zero,
   * because a zero is a claim and this is a gap.
   */
  blank: boolean;
}

/**
 * Fold the two sources into one month-by-month answer.
 *
 * Pure, and the whole rule lives here: which side of "now" a month
 * falls on decides which source speaks for it, and a month neither can
 * speak for is blank rather than zero.
 */
export function combineSavings(params: {
  /** 'YYYY-MM', in the order wanted back. */
  months: readonly string[];
  /** The month the book is in. Anything before it is history. */
  currentMonth: string;
  /** The first month the ledger knows anything about; null for an empty book. */
  firstLedgerMonth: string | null;
  actualByMonth: ReadonlyMap<string, { income: number; expense: number }>;
  budgetByMonth: ReadonlyMap<string, { income: number; expense: number }>;
}): MonthlySaving[] {
  return params.months.map((month) => {
    const past = month < params.currentMonth;
    const figures = past ? params.actualByMonth.get(month) : params.budgetByMonth.get(month);
    const blank = past
      ? params.firstLedgerMonth === null || month < params.firstLedgerMonth
      : figures === undefined;

    const income = blank ? 0 : (figures?.income ?? 0);
    const expense = blank ? 0 : (figures?.expense ?? 0);

    return {
      month,
      income,
      expense,
      saving: income - expense,
      source: past ? "actual" : "budget",
      blank,
    };
  });
}

/**
 * What a set of months adds up to, or null when not one of them had
 * anything to say.
 *
 * Null rather than zero on purpose: a roadmap year with no history and
 * no budget must fall back to the figure the reader typed, and a zero
 * here would silently overwrite it with "you will save nothing".
 */
export function sumSavings(rows: readonly MonthlySaving[]): number | null {
  if (rows.every((row) => row.blank)) return null;
  return rows.reduce((total, row) => total + row.saving, 0);
}

/**
 * The months' savings, read from the ledger behind us and the budgets
 * ahead of us.
 *
 * Two queries whatever the range: the ledger side is one grouped scan
 * (see getPeriodTotals) and the budget side one indexed range, rather
 * than a round trip per month for what could be forty years of them.
 */
export async function getMonthlySavings(
  db: Db,
  params: {
    sectionId: string;
    /** 'YYYY-MM', oldest first. */
    months: readonly string[];
    /** The month the book is in — anything before it is read as history. */
    currentMonth: string;
    /** The first month the ledger knows anything about; null for an empty book. */
    firstLedgerMonth: string | null;
  },
): Promise<MonthlySaving[]> {
  if (params.months.length === 0) return [];

  const past = params.months.filter(
    (m) =>
      m < params.currentMonth && params.firstLedgerMonth !== null && m >= params.firstLedgerMonth,
  );
  const ahead = params.months.filter((m) => m >= params.currentMonth);

  const [actuals, budgetRows] = await Promise.all([
    past.length > 0
      ? getPeriodTotals(db, { sectionId: params.sectionId, periods: past })
      : Promise.resolve([]),
    ahead.length > 0
      ? db
          .select({ periodKey: budgets.periodKey, group: accounts.group, amount: budgets.amount })
          .from(budgets)
          .innerJoin(accounts, eq(budgets.accountId, accounts.id))
          .where(
            and(
              eq(budgets.sectionId, params.sectionId),
              eq(budgets.period, "month"),
              // A range rather than a 480-item IN list: the months asked
              // for are contiguous, and this rides the unique index.
              gte(budgets.periodKey, ahead[0]),
              lte(budgets.periodKey, ahead[ahead.length - 1]),
              inArray(accounts.group, ["income", "expense"]),
            ),
          )
      : Promise.resolve([]),
  ]);

  const actualByMonth = new Map(actuals.map((a) => [a.period, a]));
  const budgetByMonth = new Map<string, { income: number; expense: number }>();
  for (const row of budgetRows) {
    const bucket = budgetByMonth.get(row.periodKey) ?? { income: 0, expense: 0 };
    if (row.group === "income") bucket.income += row.amount;
    else bucket.expense += row.amount;
    budgetByMonth.set(row.periodKey, bucket);
  }

  return combineSavings({ ...params, actualByMonth, budgetByMonth });
}
