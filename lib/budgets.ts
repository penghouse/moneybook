import type { BudgetPeriod } from "@/db/schema";

export interface BudgetPeriodRef {
  period: BudgetPeriod;
  periodKey: string;
}

/**
 * A budget's period is derived from the shape of its key — '2026-08' is
 * a month, '2026' is a year — rather than carried alongside it.
 *
 * The DB stores both columns because a CHECK needs the discriminator to
 * check against, but everywhere a period arrives from outside (a URL, a
 * form field, a CSV cell) it arrives as the key alone. Carrying the pair
 * across those boundaries would let the two disagree — `period=year`
 * with key `2026-08` — and the DB would then reject on a constraint the
 * user never saw. Derived, that state cannot be represented.
 *
 * Returns null for anything that is neither shape.
 */
export function parseBudgetPeriod(value: string): BudgetPeriodRef | null {
  const key = value.trim();
  if (/^\d{4}-\d{2}$/.test(key)) return { period: "month", periodKey: key };
  if (/^\d{4}$/.test(key)) return { period: "year", periodKey: key };
  return null;
}
