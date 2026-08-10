import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { accounts, transactionLines, transactions, type AccountGroup } from "@/db/schema";
import type { Db } from "@/db/types";
import { normalBalance } from "./normal-balance";

/**
 * Every account's figure at every month in `months`, for a chart that
 * draws several series over time.
 *
 * One query for the whole window rather than one per month: twelve
 * months of a dozen categories is otherwise twelve round trips to say
 * something the database can say once.
 *
 * `mode` is the same level/flow distinction the reports draw. A balance
 * carries forward, so it is accumulated from the beginning of the book
 * — a month with no transactions still holds last month's money. A flow
 * is the month's own total and starts from zero each time.
 */
export async function getMonthlyAccountAmounts(
  db: Db,
  params: {
    sectionId: string;
    /** 'YYYY-MM', oldest first. */
    months: readonly string[];
    mode: "balance" | "flow";
  },
): Promise<Map<string, Map<string, number>>> {
  const byMonth = new Map<string, Map<string, number>>();
  for (const month of params.months) byMonth.set(month, new Map());
  if (params.months.length === 0) return byMonth;

  const last = params.months[params.months.length - 1];
  // '2026-06-31' is not a date, and that is the point: dates are stored
  // as ISO strings and compared as strings, so this is simply a bound no
  // real day of that month can be greater than. Working out the true
  // last day would buy nothing and get February wrong.
  const lastDay = `${last}-31`;
  const net = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${transactionLines.baseAmount} else -${transactionLines.baseAmount} end)`;
  const month = sql<string>`substr(${transactions.date}, 1, 7)`;

  const rows = await db
    .select({
      accountId: transactionLines.accountId,
      group: accounts.group,
      month,
      net,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(
      and(
        eq(transactions.sectionId, params.sectionId),
        lte(transactions.date, lastDay),
        // A flow only needs the window; a balance needs everything
        // before it too, or the first month would open at zero.
        ...(params.mode === "flow" ? [gte(transactions.date, `${params.months[0]}-01`)] : []),
      ),
    )
    .groupBy(transactionLines.accountId, accounts.group, month);

  // Signed the way the reports print it, then folded into the months.
  const deltas = new Map<string, Map<string, number>>();
  const groupOf = new Map<string, AccountGroup>();
  for (const row of rows) {
    groupOf.set(row.accountId, row.group);
    if (!deltas.has(row.month)) deltas.set(row.month, new Map());
    const inMonth = deltas.get(row.month)!;
    inMonth.set(row.accountId, (inMonth.get(row.accountId) ?? 0) + Number(row.net));
  }

  const wanted = new Set(params.months);
  // Every month the data touches *and* every month asked for, in order.
  // Both halves matter: the months before the window are what a balance
  // accumulates from, and the asked-for months with nothing in them are
  // where it has to be written down anyway.
  const walk = [...new Set([...deltas.keys(), ...params.months])].sort();

  const running = new Map<string, number>();
  for (const m of walk) {
    const inMonth = deltas.get(m);
    if (params.mode === "balance") {
      // Carried: last month's money is still there in a month nobody
      // spent any.
      if (inMonth) for (const [id, d] of inMonth) running.set(id, (running.get(id) ?? 0) + d);
    } else {
      // Cleared: a flow is the month's own total. Left standing, an
      // account would repeat its last non-empty month for every later
      // month that happened to have activity on some *other* account.
      running.clear();
      if (inMonth) for (const [id, d] of inMonth) running.set(id, d);
    }
    if (!wanted.has(m)) continue;
    const out = byMonth.get(m)!;
    for (const [id, value] of running) out.set(id, normalBalance(groupOf.get(id)!, value));
  }

  return byMonth;
}

export interface MonthlyBalanceSheet {
  yearMonth: string;
  /** Base-currency minor units, normal-balance direction (both usually >= 0). */
  assets: number;
  liabilities: number;
  /** assets − liabilities. */
  netWorth: number;
}

/**
 * The balance sheet as it stood at the end of each requested month.
 *
 * A balance is a *level*, not a flow, so this cannot be a per-month
 * aggregate the way `getMonthlyTotals` is: a month with no transactions
 * has a delta of zero and a balance equal to whatever the month before
 * ended at. Getting that wrong shows up as a chart that drops to zero
 * every quiet month, so it is what the unit test pins first.
 *
 * The whole book is summed and accumulated, then the requested window is
 * sliced off the end — the months before the window are what establish
 * its opening balance, so they cannot be filtered out in SQL. At one
 * person's scale this is a single grouped scan and a fold, which beats a
 * window function over a generated month series for readability at no
 * practical cost.
 */
export async function getMonthlyBalanceSheet(
  db: Db,
  params: { sectionId: string; months: readonly string[] },
): Promise<MonthlyBalanceSheet[]> {
  if (params.months.length === 0) return [];
  const sortedMonths = [...params.months].sort();
  const lastMonth = sortedMonths[sortedMonths.length - 1];

  const yearMonth = sql<string>`substr(${transactions.date}, 1, 7)`;
  const net = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${transactionLines.baseAmount} else -${transactionLines.baseAmount} end)`;

  const rows = await db
    .select({ yearMonth, group: accounts.group, net })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(
      and(
        eq(transactions.sectionId, params.sectionId),
        lte(yearMonth, lastMonth),
        inArray(accounts.group, ["asset", "liability"]),
      ),
    )
    .groupBy(yearMonth, accounts.group);

  const deltasByMonth = new Map<string, { assets: number; liabilities: number }>();
  for (const row of rows) {
    const bucket = deltasByMonth.get(row.yearMonth) ?? { assets: 0, liabilities: 0 };
    if (row.group === "asset") bucket.assets += row.net;
    else bucket.liabilities += normalBalance("liability", row.net);
    deltasByMonth.set(row.yearMonth, bucket);
  }

  let assets = 0;
  let liabilities = 0;
  const running = new Map<string, { assets: number; liabilities: number }>();
  for (const month of [...deltasByMonth.keys()].sort()) {
    const delta = deltasByMonth.get(month)!;
    assets += delta.assets;
    liabilities += delta.liabilities;
    running.set(month, { assets, liabilities });
  }

  // Carry the last known balance forward across months with no activity,
  // rather than reporting them as zero.
  const monthsWithActivity = [...running.keys()].sort();
  return sortedMonths.map((month) => {
    let latest = { assets: 0, liabilities: 0 };
    for (const activeMonth of monthsWithActivity) {
      if (activeMonth > month) break;
      latest = running.get(activeMonth)!;
    }
    return {
      yearMonth: month,
      assets: latest.assets,
      liabilities: latest.liabilities,
      netWorth: latest.assets - latest.liabilities,
    };
  });
}
