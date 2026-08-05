/**
 * Calendar dates ('YYYY-MM-DD') and year-months ('YYYY-MM') are plain
 * strings with no timezone attached — they're accounting-period labels,
 * not instants, and must never be run through Date/UTC conversion once
 * they exist. A section's timezone matters only at the two boundaries
 * below: deciding what "today" is, and computing period boundaries
 * relative to it.
 */

export function today(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

export function yearMonthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthRange(yearMonth: string): { from: string; to: string } {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${yearStr}-${monthStr}-01`,
    to: `${yearStr}-${monthStr}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

/**
 * Calendar arithmetic on a date string, via UTC so it is never nudged by
 * a local timezone — the string going in has no timezone and neither has
 * the one coming out.
 */
export function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
}

export function addMonths(yearMonth: string, delta: number): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const totalMonths = Number(yearStr) * 12 + (Number(monthStr) - 1) + delta;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
