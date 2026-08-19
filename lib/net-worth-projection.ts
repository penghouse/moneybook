import type { MonthlyBalanceSheet } from "./ledger";
import type { MonthlySaving } from "./savings";

/**
 * One month of the net worth chart, with the two things that make a
 * month ahead of us different from one behind us.
 *
 * A month past today is not empty — an entry can be dated in advance,
 * and where none is, the balance sheet carries the last known balance
 * forward. Both are worth drawing. What neither is, is *settled*, so the
 * stroke says so by breaking; the figures themselves are the ledger's
 * own either way.
 *
 * Beside them runs a second answer for the same months: where 수입예산 −
 * 지출예산 would take the total. The two disagree on purpose — one is
 * what the book already holds, the other is what the plan expects — and
 * seeing the gap is the point.
 */
export interface NetWorthPoint {
  yearMonth: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  /** Past today: carried forward, or dated in advance, but not settled. */
  ahead: boolean;
  /**
   * Net worth as the budget expects it. Null behind us, where the ledger
   * has already answered, and null past the month the budget stops
   * speaking for.
   */
  expected: number | null;
}

/**
 * Run the budget forward from the last settled balance the book has.
 *
 * The current month is the join: it is the last settled point *and* the
 * anchor the forecast leaves from, so the two lines meet at a shared
 * point rather than at a gap. Its own budget is not applied — part of
 * the month is already in the ledger's figure, and adding the whole
 * month's budget on top would count that part twice.
 *
 * Where the budget runs out, so does the forecast. Continuing at zero
 * change would draw a flat expectation that was never expected.
 */
export function projectNetWorth(params: {
  /** The balance sheet as the ledger has it, oldest first. */
  history: readonly MonthlyBalanceSheet[];
  /** 수입예산 − 지출예산 for the months ahead (lib/savings). */
  savings: readonly MonthlySaving[];
  /** The month the book is in. */
  currentMonth: string;
}): NetWorthPoint[] {
  const { history, savings, currentMonth } = params;
  if (history.length === 0) return [];

  const savingByMonth = new Map(savings.map((s) => [s.month, s]));
  const budgeted = savings.filter((s) => s.month > currentMonth && !s.blank);
  const lastBudgeted = budgeted.length > 0 ? budgeted[budgeted.length - 1].month : null;

  // Where the forecast starts. Normally the last settled month on
  // screen; for a range that begins ahead of us there is none, and the
  // balance carried into it is what the first row already reports.
  let running: number | null = history[0].yearMonth > currentMonth ? history[0].netWorth : null;

  return history.map((month) => {
    const ahead = month.yearMonth > currentMonth;
    let expected: number | null = null;

    if (!ahead) {
      running = month.netWorth;
      // The anchor, drawn only when there is a forecast to anchor.
      if (lastBudgeted !== null && month.yearMonth === currentMonth) expected = month.netWorth;
    } else {
      const reached = lastBudgeted !== null && month.yearMonth <= lastBudgeted;
      running =
        reached && running !== null
          ? running + (savingByMonth.get(month.yearMonth)?.saving ?? 0)
          : null;
      expected = running;
    }

    return {
      yearMonth: month.yearMonth,
      assets: month.assets,
      liabilities: month.liabilities,
      netWorth: month.netWorth,
      ahead,
      expected,
    };
  });
}
