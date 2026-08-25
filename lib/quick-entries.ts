import { addMonths } from "./date";

/**
 * One past transaction, reduced to what a repeat of it would need.
 *
 * Only entries with exactly one leg per side get this far. A split
 * cannot say which of its four legs a repeat meant, and half-filling a
 * form is worse than filling none of it — the same line the 적요
 * suggestions already draw.
 */
export interface QuickEntryOccurrence {
  title: string;
  /** 'YYYY-MM', which is the unit the monthly test is asked in. */
  month: string;
  /** 'YYYY-MM-DD'. Ties are broken by it, newest first. */
  date: string;
  leftAccountId: string;
  rightAccountId: string;
  /** Major units, as the amount box shows it. */
  amountMajor: number;
}

export interface QuickEntry {
  title: string;
  leftAccountId: string;
  rightAccountId: string;
  /** What it was last time. The starting point, not a claim. */
  amountMajor: number;
  /** How many distinct months of the window it appeared in. */
  months: number;
  /** How many times, all told. */
  count: number;
  /** Looks like a standing commitment — 월세, 통신비, 보험료. */
  monthly: boolean;
  /** Monthly, and this month has none yet. */
  due: boolean;
}

/** How far back the counting looks, this month not included. */
export const QUICK_ENTRY_WINDOW = 6;

/**
 * Twice before it counts as a repeat.
 *
 * One entry is not a habit, and a chip offering to repeat the thing that
 * was *just* saved is noise sitting where the useful ones go — the row
 * would fill up with one-offs the day the book was started.
 */
const MIN_OCCURRENCES = 2;

/**
 * Months of the window it has to appear in before the book will call it
 * monthly. Three of six is loose enough for a bill that skipped a month
 * and tight enough that a coincidence of three lunches does not qualify.
 */
const MONTHLY_THRESHOLD = 3;

/**
 * How recently it must have happened. Without this a subscription
 * cancelled in the spring stays on the list all year, permanently marked
 * as 「아직 안 넣음」 — nagging for something that is never coming.
 */
const STALE_AFTER_MONTHS = 2;

/**
 * What the entry form should offer as one-tap repeats, and which of them
 * this month is still missing.
 *
 * Nothing is registered and nothing is scheduled. The book already knows
 * that 월세 moved between the same two accounts on about the same day
 * for about the same amount, six months running — asking the reader to
 * write that down a second time, in a settings screen, would be asking
 * them to repeat what they have already told it.
 *
 * And nothing is posted automatically. A row in a double-entry ledger is
 * a claim that something happened; a row the app wrote by itself is a
 * forecast wearing the same clothes, and the balance it lands in would
 * drift from the real account with nothing on screen to say so. What the
 * reader actually wanted was to not forget — so the list says what is
 * missing and the saving stays theirs.
 */
export function buildQuickEntries(params: {
  occurrences: readonly QuickEntryOccurrence[];
  /** 'YYYY-MM'. The month being entered, which is never counted. */
  currentMonth: string;
  limit?: number;
}): QuickEntry[] {
  const { occurrences, currentMonth, limit = 8 } = params;
  const oldest = addMonths(currentMonth, -QUICK_ENTRY_WINDOW);
  const staleBefore = addMonths(currentMonth, -STALE_AFTER_MONTHS);

  interface Bucket {
    title: string;
    pastMonths: Set<string>;
    inCurrentMonth: boolean;
    count: number;
    latest: QuickEntryOccurrence;
  }
  const byTitle = new Map<string, Bucket>();

  for (const row of occurrences) {
    if (row.month < oldest || row.month > currentMonth) continue;
    const key = row.title.trim();
    if (!key) continue;

    const bucket = byTitle.get(key);
    if (!bucket) {
      byTitle.set(key, {
        title: key,
        pastMonths: row.month < currentMonth ? new Set([row.month]) : new Set(),
        inCurrentMonth: row.month === currentMonth,
        count: 1,
        latest: row,
      });
      continue;
    }
    bucket.count += 1;
    if (row.month < currentMonth) bucket.pastMonths.add(row.month);
    if (row.month === currentMonth) bucket.inCurrentMonth = true;
    // Newest wins, so the accounts and the amount are the last shape it
    // took rather than the first.
    if (row.date > bucket.latest.date) bucket.latest = row;
  }

  const entries: QuickEntry[] = [...byTitle.values()].map((bucket) => {
    const months = bucket.pastMonths.size;
    const lastPast = [...bucket.pastMonths].sort().at(-1);
    const monthly =
      months >= MONTHLY_THRESHOLD &&
      (bucket.inCurrentMonth || (lastPast !== undefined && lastPast >= staleBefore));

    return {
      title: bucket.title,
      count: bucket.count,
      leftAccountId: bucket.latest.leftAccountId,
      rightAccountId: bucket.latest.rightAccountId,
      amountMajor: bucket.latest.amountMajor,
      months,
      monthly,
      due: monthly && !bucket.inCurrentMonth,
    };
  });

  // What is missing comes first: it is the only part of this list with a
  // deadline, and burying it under the lunches would be leaving the one
  // job the reader wanted done to chance.
  return entries
    .filter((entry) => entry.count >= MIN_OCCURRENCES)
    .sort(
      (a, b) =>
        Number(b.due) - Number(a.due) ||
        b.months - a.months ||
        a.title.localeCompare(b.title, "ko"),
    )
    .slice(0, limit);
}
