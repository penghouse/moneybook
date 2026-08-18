import type { MonthlyBalanceSheet } from "./ledger";
import type { MonthlySaving } from "./savings";

/**
 * One month of the net worth chart — behind us as the ledger has it,
 * ahead of us as the budget expects it.
 *
 * The balance sheet carries the last known balance forward across months
 * with no activity, which is right for a gap between two entries and
 * wrong for the future: a flat line running off the right edge is not a
 * forecast, it is the absence of one drawn to look like a claim. Ahead of
 * now the two component lines say nothing, and the only figure worth
 * drawing is where 수입예산 − 지출예산 would take the total.
 */
export interface NetWorthPoint {
  yearMonth: string;
  /** Null ahead of now — a month that has not happened has no balance sheet. */
  assets: number | null;
  liabilities: number | null;
  /** Null past the point where the budget stops speaking. */
  netWorth: number | null;
  /** True where the figure comes from the budget rather than the ledger. */
  projected: boolean;
}

/**
 * Run the budget forward from the last balance the book actually has.
 *
 * The current month is the join: it is the last actual point *and* the
 * anchor the dotted line leaves from, so the two meet at a shared point
 * rather than at a gap. Its own budget is not applied — part of the month
 * is already in the ledger's figure, and adding the whole month's budget
 * on top of it would count that part twice.
 *
 * Where the budget runs out, so does the line. Continuing at zero change
 * would draw a flat forecast that was never forecast.
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

  // Where the dotted line starts. Normally the last actual month on
  // screen; for a range that begins ahead of us there is none, and the
  // balance sheet's own carry-forward already reports today's figure for
  // every month in it, so the first row is the anchor.
  let running: number | null = history[0].yearMonth > currentMonth ? history[0].netWorth : null;

  return history.map((month) => {
    if (month.yearMonth <= currentMonth) {
      running = month.netWorth;
      return {
        yearMonth: month.yearMonth,
        assets: month.assets,
        liabilities: month.liabilities,
        netWorth: month.netWorth,
        projected: false,
      };
    }

    const reached = lastBudgeted !== null && month.yearMonth <= lastBudgeted;
    running =
      reached && running !== null
        ? running + (savingByMonth.get(month.yearMonth)?.saving ?? 0)
        : null;
    return {
      yearMonth: month.yearMonth,
      assets: null,
      liabilities: null,
      netWorth: running,
      projected: true,
    };
  });
}
