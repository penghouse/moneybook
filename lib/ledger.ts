import { and, asc, eq, gte, inArray, like as like_, lte, or, sql, type SQL } from "drizzle-orm";
import {
  accounts,
  transactionLines,
  transactions,
  type AccountGroup,
  type LineSide,
  type TransactionKind,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { monthRange, yearRange } from "./date";
import { getOrFetchRate, RateUnavailableError } from "./exchange-rates";
import { convertMinorUnits } from "./money";
import { hasTag, normalizeTag } from "./tags";
import { bareTitle } from "./titles";

const CREDIT_NORMAL_GROUPS: ReadonlySet<AccountGroup> = new Set(["liability", "equity", "income"]);

/**
 * Flips sign for credit-normal groups so a "healthy" balance is always
 * positive: money owed on a credit card, equity, and income all read as
 * positive numbers, even though they're right(credit)-heavy in raw
 * left-minus-right terms.
 */
function normalBalance(group: AccountGroup, netLeftMinusRight: number): number {
  return CREDIT_NORMAL_GROUPS.has(group) ? -netLeftMinusRight : netLeftMinusRight;
}

export class UnbalancedTransactionError extends Error {}

export interface BalanceLineInput {
  side: LineSide;
  currency: string;
  amount: number;
  rate: number | null;
  baseAmount: number;
}

/**
 * The one gate every save path (server actions, CSV import, the
 * "환율 반영" revaluation flow) must pass before a transaction's lines
 * are written. Throws on the first violation rather than collecting all
 * of them — this app's transactions are small enough that "fix one, try
 * again" is fine.
 *
 * A `kind: 'revaluation'` transaction is special: the leg denominated in
 * a foreign (non-base) currency moves baseAmount without moving its own
 * currency's amount (the point of a revaluation is that the dollar
 * balance didn't change, only its won valuation did), so that leg is
 * exempt from the amount*rate=baseAmount check and must have amount=0,
 * rate=null instead. The offsetting P&L leg (외화환산이익/손실), which is
 * denominated in the base currency itself, is not exempt and is
 * validated normally.
 */
export function assertBalanced(
  lines: readonly BalanceLineInput[],
  baseCurrency: string,
  kind: TransactionKind = "normal",
): void {
  if (lines.length < 2) {
    throw new UnbalancedTransactionError("a transaction needs at least two lines");
  }
  if (!lines.some((l) => l.side === "left") || !lines.some((l) => l.side === "right")) {
    throw new UnbalancedTransactionError(
      "a transaction needs at least one left line and one right line",
    );
  }

  let left = 0;
  let right = 0;

  for (const line of lines) {
    if (line.amount < 0 || line.baseAmount < 0) {
      throw new UnbalancedTransactionError(
        "amount and baseAmount must not be negative; direction comes from `side`",
      );
    }

    const isRevaluationLeg = kind === "revaluation" && line.currency !== baseCurrency;

    if (isRevaluationLeg) {
      if (line.rate !== null || line.amount !== 0) {
        throw new UnbalancedTransactionError(
          "a revaluation line in a foreign currency must have amount=0 and rate=null",
        );
      }
    } else {
      if (line.rate === null || line.rate <= 0) {
        throw new UnbalancedTransactionError("a non-revaluation line needs a positive rate");
      }
      const expected = convertMinorUnits(line.amount, line.rate, line.currency, baseCurrency);
      if (expected !== line.baseAmount) {
        throw new UnbalancedTransactionError(
          `baseAmount (${line.baseAmount}) does not match amount*rate (expected ${expected})`,
        );
      }
    }

    if (line.side === "left") left += line.baseAmount;
    else right += line.baseAmount;
  }

  if (left !== right) {
    throw new UnbalancedTransactionError(`left (${left}) and right (${right}) do not balance`);
  }
}

export interface AccountBalance {
  accountId: string;
  group: AccountGroup;
  name: string;
  currency: string;
  /** Signed, in the account's own currency's minor units. Positive = normal balance direction. */
  amount: number;
  /** Signed, in the section's base currency's minor units. Positive = normal balance direction. */
  baseAmount: number;
}

async function queryAccountNets(db: Db, conditions: readonly SQL[]): Promise<AccountBalance[]> {
  const netAmount = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${transactionLines.amount} else -${transactionLines.amount} end)`;
  const netBaseAmount = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${transactionLines.baseAmount} else -${transactionLines.baseAmount} end)`;

  const rows = await db
    .select({
      accountId: accounts.id,
      group: accounts.group,
      name: accounts.name,
      currency: accounts.currency,
      amount: netAmount,
      baseAmount: netBaseAmount,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(and(...conditions))
    .groupBy(accounts.id, accounts.group, accounts.name, accounts.currency)
    // The chart of accounts is ordered by hand on /accounts, and every
    // screen that lists accounts should read in that same order. Without
    // this the balance sheet came back in whatever order the group-by
    // happened to produce, which is stable enough not to look broken and
    // arbitrary enough never to match the page the user set it on.
    // Group order is applied by the caller, which knows the section.
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));

  return rows.map((r) => ({
    accountId: r.accountId,
    group: r.group,
    name: r.name,
    currency: r.currency,
    amount: normalBalance(r.group, r.amount),
    baseAmount: normalBalance(r.group, r.baseAmount),
  }));
}

/**
 * Point-in-time balance per account with any activity on or before
 * `asOf`. Accounts with no lines in range are omitted, not zero-filled —
 * that's a presentation-layer join against the full account list.
 */
export async function getAccountBalances(
  db: Db,
  params: { sectionId: string; asOf: string },
): Promise<AccountBalance[]> {
  return queryAccountNets(db, [
    eq(transactions.sectionId, params.sectionId),
    lte(transactions.date, params.asOf),
  ]);
}

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

  const running = new Map<string, number>();
  const wanted = new Set(params.months);
  // Every month the data touches, in order — including ones before the
  // window, which a balance has to walk through to carry forward.
  for (const m of [...deltas.keys()].sort()) {
    for (const [accountId, delta] of deltas.get(m)!) {
      running.set(
        accountId,
        (params.mode === "balance" ? (running.get(accountId) ?? 0) : 0) + delta,
      );
    }
    if (!wanted.has(m)) continue;
    const out = byMonth.get(m)!;
    for (const [accountId, value] of running) {
      out.set(accountId, normalBalance(groupOf.get(accountId)!, value));
    }
  }

  // A balance carries into months with no transactions of their own.
  if (params.mode === "balance") {
    let carried = new Map<string, number>();
    for (const m of params.months) {
      const out = byMonth.get(m)!;
      if (out.size === 0) {
        for (const [id, v] of carried) out.set(id, v);
      } else {
        carried = new Map(out);
      }
    }
  }

  return byMonth;
}

/** Same shape as getAccountBalances, but net activity within [from, to] inclusive. */
export async function getAccountFlows(
  db: Db,
  params: { sectionId: string; from: string; to: string },
): Promise<AccountBalance[]> {
  return queryAccountNets(db, [
    eq(transactions.sectionId, params.sectionId),
    gte(transactions.date, params.from),
    lte(transactions.date, params.to),
  ]);
}

export interface TitleTotal {
  /** The 적요, read without its parentheses. */
  name: string;
  /** Signed, in the account's own currency's minor units, normal-balance direction. */
  amount: number;
}

/**
 * One account's own transactions grouped by 적요, biggest first.
 *
 * Two screens ask this, and they are the same question over different
 * dates:
 *
 * - **거래처별 잔액** — who the money is still with. A level, so the
 *   dates are the account's own start to today, never the period the
 *   screen happens to show: answering it for August alone would report
 *   someone as settled up because they did not pay this month.
 * - **적요별 비중** — what the period's spending on this account went
 *   on. A flow, so the dates *are* the period being read.
 *
 * The 적요 is read without its parentheses (see `bareTitle`), so
 * 「점심」 and 「점심(회사 앞)」 are one line rather than two halves of
 * one. Untitled transactions collect under one bucket named by the
 * caller rather than vanishing, since their money is in the account
 * either way.
 *
 * Zero nets are dropped: a 적요 that comes to nothing contributes
 * nothing to the total, so removing its row cannot move one.
 */
export async function getTitleTotals(
  db: Db,
  params: {
    sectionId: string;
    accountId: string;
    group: AccountGroup;
    from?: string | null;
    to: string;
    untitledLabel: string;
  },
): Promise<TitleTotal[]> {
  const net = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${transactionLines.amount} else -${transactionLines.amount} end)`;

  const rows = await db
    .select({ title: transactions.title, net })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.sectionId, params.sectionId),
        eq(transactionLines.accountId, params.accountId),
        ...(params.from ? [gte(transactions.date, params.from)] : []),
        lte(transactions.date, params.to),
      ),
    )
    .groupBy(transactions.title);

  // Merged after the query rather than in it, because SQL would group
  // apart several things a reader counts as one counterparty: an empty
  // title and a title of whitespace, and 「한석상여」 against
  // 「한석상여(리텐션뱉)」. The parenthesis says what a particular
  // transaction was for, not who it was with, so it cannot be allowed to
  // split someone's balance in two — see `bareTitle`.
  const byName = new Map<string, number>();
  for (const row of rows) {
    const name = bareTitle(row.title) || params.untitledLabel;
    byName.set(name, (byName.get(name) ?? 0) + normalBalance(params.group, row.net));
  }

  return [...byName.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .filter((b) => b.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

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

interface UnrealizedFxBase {
  accountId: string;
  name: string;
  currency: string;
  /** Signed, own-currency minor units — normal-balance direction. */
  amount: number;
  /** Signed, base-currency minor units, fixed at each transaction's own rate. */
  bookBaseAmount: number;
}

export type UnrealizedFx = UnrealizedFxBase &
  (
    | {
        rateUnavailable: false;
        /** Signed, base-currency minor units, at asOf's rate. */
        currentBaseAmount: number;
        unrealized: number;
        rateDate: string;
        isFallback: boolean;
      }
    /**
     * No rate could be fetched or fallen back to for this currency. The
     * account's book value is still known and still counts toward the
     * balance sheet totals, so this is reported rather than thrown —
     * a missing rate must never take down the whole page.
     */
    | { rateUnavailable: true }
  );

/** An entry whose current value is known — the only kind that can be revalued. */
export type ResolvedUnrealizedFx = Extract<UnrealizedFx, { rateUnavailable: false }>;

/**
 * For every foreign-currency account with a nonzero balance, compares
 * its recorded (book) base-currency value against what it's worth at
 * asOf's exchange rate. The gap is what a "환율 반영" revaluation would
 * post — this function only reads, it never writes.
 *
 * Balance-sheet totals are always book value (fixed at each
 * transaction's own rate), so nothing here feeds them; a currency whose
 * rate is unavailable simply can't show a current value or an
 * unrealized difference until a rate exists.
 */
export async function getUnrealizedFx(
  db: Db,
  params: { sectionId: string; baseCurrency: string; asOf: string },
): Promise<UnrealizedFx[]> {
  const balances = await getAccountBalances(db, {
    sectionId: params.sectionId,
    asOf: params.asOf,
  });
  const foreign = balances.filter((b) => b.currency !== params.baseCurrency && b.amount !== 0);

  const results: UnrealizedFx[] = [];
  for (const b of foreign) {
    const base: UnrealizedFxBase = {
      accountId: b.accountId,
      name: b.name,
      currency: b.currency,
      amount: b.amount,
      bookBaseAmount: b.baseAmount,
    };

    let rate;
    try {
      rate = await getOrFetchRate(db, {
        date: params.asOf,
        base: b.currency,
        quote: params.baseCurrency,
      });
    } catch (error) {
      if (error instanceof RateUnavailableError) {
        results.push({ ...base, rateUnavailable: true });
        continue;
      }
      throw error;
    }

    const currentBaseAmount = convertMinorUnits(
      b.amount,
      rate.rate,
      b.currency,
      params.baseCurrency,
    );
    results.push({
      ...base,
      rateUnavailable: false,
      currentBaseAmount,
      unrealized: currentBaseAmount - b.baseAmount,
      rateDate: rate.date,
      isFallback: rate.isFallback,
    });
  }
  return results;
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

export interface RunningBalance {
  transactionId: string;
  /** Signed, in `currency`'s minor units. */
  amount: number;
  currency: string;
}

/**
 * The balance standing *after* each transaction, for the balance column
 * in the transaction list.
 *
 * Two modes, because "the balance" means different things depending on
 * what the list is showing:
 *
 * - **No account filter** → net worth, in the base currency. Note this
 *   is unchanged by a transfer between two asset accounts, which is
 *   correct and is the quickest way to sanity-check the sign handling.
 * - **One account** → that account's own balance, in *its* currency. A
 *   bank balance is the money in that account, not its base-currency
 *   valuation.
 *
 * `from` bounds where the running sum starts. Omit it for a level — a
 * bank balance is what carries forward, and starting it at the top of
 * the month would report the month's movement as the balance. Pass it
 * for a flow account, where the opposite holds: 식비's running sum only
 * means something inside a period, and "since the book began" is a
 * number nobody has a use for.
 *
 * Net worth needs no per-group sign flip. `normalBalance` negates
 * credit-normal groups, so assets carry `left − right` and liabilities
 * carry `−(left − right)`; net worth is `assets − liabilities`, and the
 * two negations cancel. Both groups therefore contribute raw
 * `left − right` and a single CASE covers them.
 *
 * The running sum must cover every earlier transaction, not just the
 * ones on screen, so the window runs over the whole section and only the
 * requested ids are returned. `id` is the final tiebreak in the window's
 * ORDER BY, and the caller's list query must break ties the same way —
 * otherwise two transactions sharing a date and timestamp can be summed
 * in one order and displayed in another, which shows up as balances that
 * appear to run backwards.
 */
export async function getRunningBalances(
  db: Db,
  params: {
    sectionId: string;
    baseCurrency: string;
    transactionIds: readonly string[];
    /** Omit for net worth across the whole book. */
    account?: { id: string; group: AccountGroup; currency: string };
    /** Earliest date the running sum counts from; omit to run over all history. */
    from?: string;
  },
): Promise<RunningBalance[]> {
  if (params.transactionIds.length === 0) return [];

  const { account } = params;
  const column = account ? transactionLines.amount : transactionLines.baseAmount;
  const delta = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${column} else -${column} end)`;

  const scope = account
    ? sql`${transactionLines.accountId} = ${account.id}`
    : sql`${accounts.group} in ('asset', 'liability')`;
  const since = params.from ? sql` and ${transactions.date} >= ${params.from}` : sql``;

  const rows = await db.all<{ id: string; running: number }>(sql`
    with tx_delta as (
      select ${transactions.id} as id,
             ${transactions.date} as date,
             ${transactions.createdAt} as created_at,
             ${delta} as delta
      from ${transactionLines}
      inner join ${transactions} on ${transactionLines.transactionId} = ${transactions.id}
      inner join ${accounts} on ${transactionLines.accountId} = ${accounts.id}
      where ${transactions.sectionId} = ${params.sectionId} and ${scope}${since}
      group by ${transactions.id}
    ),
    accumulated as (
      select id,
             sum(delta) over (order by date, created_at, id) as running
      from tx_delta
    )
    select id, running from accumulated
    where id in (${sql.join(
      params.transactionIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);

  return rows.map((r) => ({
    transactionId: r.id,
    amount: account ? normalBalance(account.group, Number(r.running)) : Number(r.running),
    currency: account ? account.currency : params.baseCurrency,
  }));
}

/**
 * The ids of every transaction carrying `#tag` in its memo or in any of
 * its lines' memos.
 *
 * Two steps on purpose. SQL narrows with `LIKE '%#낭비%'`, which is cheap
 * but would also match 「#낭비벽」; the exact token test then happens in
 * JS, where the boundary is knowable. See lib/tags.
 *
 * Ids rather than rows, so the caller can fold them in with whatever
 * else it is filtering by — a tag inside one account's ledger, or inside
 * a month — instead of this function having to know about all of it.
 */
export async function findTaggedTransactionIds(
  db: Db,
  params: { sectionId: string; tag: string; from?: string; to?: string },
): Promise<string[]> {
  const tag = normalizeTag(params.tag);
  if (tag === null) return [];

  const like = `%#${tag}%`;
  const rows = await db
    .select({
      id: transactions.id,
      memo: transactions.memo,
      lineMemo: transactionLines.memo,
    })
    .from(transactions)
    .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.sectionId, params.sectionId),
        params.from ? gte(transactions.date, params.from) : undefined,
        params.to ? lte(transactions.date, params.to) : undefined,
        or(like_(transactions.memo, like), like_(transactionLines.memo, like)),
      ),
    );

  const memosById = new Map<string, (string | null)[]>();
  for (const row of rows) {
    const memos = memosById.get(row.id) ?? [];
    memos.push(row.memo, row.lineMemo);
    memosById.set(row.id, memos);
  }
  return [...memosById.entries()].filter(([, memos]) => hasTag(memos, tag)).map(([id]) => id);
}

export interface TitleSuggestion {
  title: string;
  /** The accounts that 적요 was last posted between, when it was a plain two-sided entry. */
  leftAccountId: string | null;
  rightAccountId: string | null;
}

/**
 * Distinct 적요 from across the book's whole history, most recently used
 * first, each carrying the pair of accounts it was last posted between.
 *
 * Most entries are repeats — 「점심」 out of 식비 and onto 신용카드 for
 * the hundredth time — so the 적요 is enough to know the rest. Picking
 * one fills the two sides and leaves the amount alone, which is the only
 * part that actually differs.
 *
 * All of history, not a window of recent rows: a 적요 used twice a year
 * is exactly the one worth being reminded of, and it is the one a
 * "last N transactions" scan loses first. The window function picks each
 * title's latest transaction in the database rather than making the
 * caller read every row to find them, so the cost does not grow with how
 * far back the book goes — only with how many distinct 적요 it holds.
 *
 * Titles are offered without their parentheses (see `bareTitle`), which
 * also folds 「커피 (스벅)」 and 「커피 (투썸)」 into one suggestion —
 * the bracket is what differs between two of the same thing, so keeping
 * it would fill the list with near-duplicates.
 *
 * Splits contribute their 적요 but no accounts — a suggestion cannot say
 * which of four legs to fill, and half-filling a form is worse than
 * filling none of it.
 */
export async function getTitleSuggestions(
  db: Db,
  params: { sectionId: string; limit?: number },
): Promise<TitleSuggestion[]> {
  const limit = params.limit ?? 50;

  // Deduped on the stored title in SQL, then again on the bare one in JS
  // — SQL cannot strip the brackets, so it is asked for more rows than
  // are wanted and the second pass closes the gap.
  const latest = await db.all<{ id: string; title: string }>(sql`
    SELECT id, title FROM (
      SELECT
        ${transactions.id} AS id,
        ${transactions.title} AS title,
        ${transactions.date} AS date,
        ${transactions.createdAt} AS created_at,
        ROW_NUMBER() OVER (
          PARTITION BY ${transactions.title}
          ORDER BY ${transactions.date} DESC, ${transactions.createdAt} DESC, ${transactions.id} DESC
        ) AS rn
      FROM ${transactions}
      WHERE ${transactions.sectionId} = ${params.sectionId} AND trim(${transactions.title}) <> ''
    )
    WHERE rn = 1
    ORDER BY date DESC, created_at DESC
    LIMIT ${limit * 4}
  `);
  if (latest.length === 0) return [];

  const lines = await db
    .select({
      transactionId: transactionLines.transactionId,
      side: transactionLines.side,
      accountId: transactionLines.accountId,
    })
    .from(transactionLines)
    .where(
      inArray(
        transactionLines.transactionId,
        latest.map((row) => row.id),
      ),
    );

  const linesById = new Map<string, { side: LineSide; accountId: string }[]>();
  for (const line of lines) {
    const bucket = linesById.get(line.transactionId) ?? [];
    bucket.push(line);
    linesById.set(line.transactionId, bucket);
  }

  const byTitle = new Map<string, TitleSuggestion>();
  for (const row of latest) {
    const title = bareTitle(row.title);
    if (!title || byTitle.has(title)) continue;

    const rowLines = linesById.get(row.id) ?? [];
    const left = rowLines.filter((l) => l.side === "left");
    const right = rowLines.filter((l) => l.side === "right");
    const simple = left.length === 1 && right.length === 1;
    byTitle.set(title, {
      title,
      leftAccountId: simple ? left[0].accountId : null,
      rightAccountId: simple ? right[0].accountId : null,
    });
    if (byTitle.size >= limit) break;
  }
  return [...byTitle.values()];
}
