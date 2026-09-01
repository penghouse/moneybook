export interface BudgetProgress {
  /** budget − actual. Null when nothing was budgeted. */
  left: number | null;
  /**
   * Rounded percent of the budget used, or null when there is nothing to
   * take a share of. A budget of exactly zero is a real setting — 「이
   * 항목엔 쓰지 않는다」 — but a share of zero is undefined, so it is the
   * percent that goes missing rather than the budget.
   */
  percent: number | null;
  over: boolean;
}

/**
 * One account's standing against its budget.
 *
 * Three lines of arithmetic, in one place because two screens now do it:
 * the budget list and the picture it exports. A picture that disagreed
 * with the screen it was taken from would be worse than no picture.
 */
export function budgetProgress(actual: number, budget: number | undefined): BudgetProgress {
  const left = budget !== undefined ? budget - actual : null;
  return {
    left,
    percent: budget !== undefined && budget > 0 ? Math.round((actual / budget) * 100) : null,
    over: left !== null && left < 0,
  };
}

/** How wide the bar is drawn: clamped, and full once it is over. */
export function budgetBarPercent(progress: BudgetProgress): number {
  // Clamped at both ends: a refund can make spend negative, and a zero
  // budget that has been spent against is fully over rather than 0% used.
  return progress.over ? 100 : Math.max(0, Math.min(100, progress.percent ?? 0));
}

/**
 * Whether 저축 belongs on a picture of these sides.
 *
 * 저축 is 수입 − 지출. Leave a side out and the figure is still true of
 * the month but no longer true of the *picture*: two numbers at the top
 * that nothing below them adds up to, which is worse than not saying
 * them at all.
 */
export function summaryBelongs(picked: number, available: number): boolean {
  return available > 0 && picked === available;
}
