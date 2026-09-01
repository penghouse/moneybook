import { isActiveDuring, type ActiveWindow } from "./accounts";
import { monthRange } from "./date";

/**
 * The months of `year` this account can be budgeted in at all.
 *
 * Not always twelve. The month screen offers an account only where it
 * overlaps the month (see `activeDuring`), so a card opened in June has
 * no January row to fill in — and holding it to twelve would mean it
 * could never be called complete.
 */
export function budgetableMonths(year: string, account: ActiveWindow): string[] {
  const months: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const key = `${year}-${String(i).padStart(2, "0")}`;
    const { from, to } = monthRange(key);
    if (isActiveDuring(account, from, to)) months.push(key);
  }
  return months;
}

/**
 * Whether the twelve months already say what the year is.
 *
 * The year screen exists to hold a cap over the monthly plan, and it
 * asked for that cap even when every month underneath it had one — an
 * empty box and a 저장 button over a figure the book had already worked
 * out. Where the months cover the year, the sum *is* the year's budget
 * until someone says otherwise.
 *
 * Complete means every month the account could be budgeted in, not
 * merely some: eleven months and a gap is a plan with a hole in it, and
 * reading it as a year's budget would quietly under-report the cap.
 */
export function monthsCoverYear(params: {
  year: string;
  account: ActiveWindow;
  /** 'YYYY-MM' keys that have a monthly budget for this account. */
  budgeted: ReadonlySet<string>;
}): boolean {
  const months = budgetableMonths(params.year, params.account);
  return months.length > 0 && months.every((month) => params.budgeted.has(month));
}
