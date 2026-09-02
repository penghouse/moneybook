import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { accounts, transactionLines, transactions } from "@/db/schema";
import type { Db } from "@/db/types";
import { monthRange, yearRange } from "../date";
import { normalBalance } from "./normal-balance";

export interface PeriodTotal {
  /** '2026-08' or '2026', matching what was asked for. */
  period: string;
  /** Base-currency minor units, both always >= 0 (already sign-normalized). */
  income: number;
  expense: number;
}

/**
 * One query grouped by period + group, not one query per period — the
 * trend chart's whole point is showing many at once.
 *
 * Months or years, told apart by the length of the keys asked for rather
 * than by a separate argument: '2026-08' is a month and '2026' is a
 * year, so a unit argument could only ever contradict them. Mixing the
 * two in one call is not meaningful and is not supported.
 */
export async function getPeriodTotals(
  db: Db,
  params: { sectionId: string; periods: readonly string[] },
): Promise<PeriodTotal[]> {
  if (params.periods.length === 0) return [];
  const sorted = [...params.periods].sort();
  const byYear = sorted[0].length === 4;
  const first = byYear ? yearRange(sorted[0]) : monthRange(sorted[0]);
  const last = byYear
    ? yearRange(sorted[sorted.length - 1])
    : monthRange(sorted[sorted.length - 1]);

  // sql.raw for the length: the same expression is repeated in GROUP BY,
  // and a bound parameter there has to line up positionally with the one
  // in the SELECT list.
  const period = sql<string>`substr(${transactions.date}, 1, ${sql.raw(byYear ? "4" : "7")})`;
  const netBaseAmount = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${transactionLines.baseAmount} else -${transactionLines.baseAmount} end)`;

  const rows = await db
    .select({ period, group: accounts.group, net: netBaseAmount })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(
      and(
        eq(transactions.sectionId, params.sectionId),
        gte(transactions.date, first.from),
        lte(transactions.date, last.to),
        inArray(accounts.group, ["income", "expense"]),
      ),
    )
    .groupBy(period, accounts.group);

  const totals = new Map<string, { income: number; expense: number }>();
  for (const key of sorted) totals.set(key, { income: 0, expense: 0 });
  for (const row of rows) {
    const bucket = totals.get(row.period);
    if (!bucket) continue; // outside the requested range (shouldn't happen given from/to)
    if (row.group === "income") bucket.income = normalBalance("income", row.net);
    else bucket.expense = normalBalance("expense", row.net);
  }

  return sorted.map((period) => ({ period, ...totals.get(period)! }));
}

/**
 * The month the book begins in, or null for a book with nothing in it.
 *
 * It is what separates 「그 달은 0원이었다」 from 「그 달은 장부 밖이다」,
 * and every screen that reads the ledger behind and the budget ahead
 * needs that line drawn before it can say either.
 */
export async function getFirstLedgerMonth(db: Db, sectionId: string): Promise<string | null> {
  const [row] = await db
    .select({ first: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.sectionId, sectionId));
  return row?.first?.slice(0, 7) ?? null;
}
