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

/**
 * Shifts a full date by whole months, keeping the day where the target
 * month has one. 1월 31일 + 1개월 is 2월 28일, not 3월 3일 — the naive
 * `setMonth` overflow is what makes month arrows skip a month every time
 * they pass a short one.
 */
export function addMonthsToDate(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = addMonths(`${year}-${String(month).padStart(2, "0")}`, delta);
  const { to } = monthRange(target);
  const lastDay = Number(to.slice(8));
  return `${target}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Whole years on a full date, clamping 2월 29일 to 2월 28일. */
export function addYearsToDate(date: string, delta: number): string {
  return addMonthsToDate(date, delta * 12);
}

export function addMonths(yearMonth: string, delta: number): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const totalMonths = Number(yearStr) * 12 + (Number(monthStr) - 1) + delta;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** 1 Jan to 31 Dec of `year` ('YYYY'), inclusive. */
export function yearRange(year: string): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function addYears(year: string, delta: number): string {
  return String(Number(year) + delta);
}

/**
 * How many periods a chart may draw before the range is refused.
 *
 * The guard is not about taste — a reversed or hand-typed range would
 * otherwise loop until the request dies, and a query string does not go
 * through the form that guards against it. 600 months is fifty years,
 * past anything a personal ledger holds.
 */
const MAX_PERIODS = 600;

/** Every month touched by [from, to], oldest first, as 'YYYY-MM'. */
export function monthsBetween(from: string, to: string): string[] {
  const last = yearMonthOf(to);
  const months: string[] = [];
  for (let m = yearMonthOf(from); m <= last && months.length < MAX_PERIODS; m = addMonths(m, 1)) {
    months.push(m);
  }
  return months;
}

/** Every year touched by [from, to], oldest first, as 'YYYY'. */
export function yearsBetween(from: string, to: string): string[] {
  const last = yearOf(to);
  const years: string[] = [];
  for (let y = yearOf(from); y <= last && years.length < MAX_PERIODS; y = addYears(y, 1)) {
    years.push(y);
  }
  return years;
}

/**
 * The window before or after [from, to], the same length as it.
 *
 * "The same length" is measured in *months* when the range is whole
 * months and in days otherwise. A twelve-month window stepped back by
 * 365 days would land on the 2nd of the month and stay one day off for
 * ever after; stepped by twelve months it lands exactly on the previous
 * twelve, which is the comparison anyone paging a chart is after.
 *
 * `delta` is in windows: -1 is the one before, +1 the one after.
 */
export function shiftWindow(from: string, to: string, delta: number): { from: string; to: string } {
  const firstOfMonth = from.slice(8) === "01";
  const lastOfMonth = to === monthRange(yearMonthOf(to)).to;

  if (firstOfMonth && lastOfMonth) {
    const months = monthsBetween(from, to).length;
    const start = addMonths(yearMonthOf(from), months * delta);
    const end = addMonths(yearMonthOf(to), months * delta);
    return { from: `${start}-01`, to: monthRange(end).to };
  }

  // Inclusive day count, so stepping back leaves no gap and no overlap.
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from: addDays(from, days * delta), to: addDays(to, days * delta) };
}

/**
 * What unit a from/to range represents, worked out from the range
 * itself rather than carried alongside it.
 *
 * Storing the unit in the URL next to the dates would let the two
 * disagree — `unit=year` with an August range — and a shared link or a
 * back-button press is exactly where that shows up. Derived, the
 * contradiction cannot be represented.
 */
export function rangeUnit(from: string, to: string): "month" | "year" | "custom" {
  const asYear = yearRange(yearOf(from));
  if (from === asYear.from && to === asYear.to) return "year";
  const asMonth = monthRange(yearMonthOf(from));
  if (from === asMonth.from && to === asMonth.to) return "month";
  return "custom";
}
