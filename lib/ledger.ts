import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  like as like_,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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

export interface CounterpartyBalance {
  /** The transaction's 적요, which on a 거래처관리 account names who the money is with. */
  name: string;
  /** Signed, in the account's own currency's minor units, normal-balance direction. */
  amount: number;
}

/**
 * One 거래처관리 account's balance broken down by counterparty, biggest
 * first.
 *
 * The counterparty is the transaction's own 적요 — see the note on
 * `accounts.tracksCounterparties` for why that is not a separate field.
 * Untitled transactions collect under one bucket named by the caller
 * rather than vanishing, since their money is in the account either way.
 *
 * Deliberately **not** bounded by any period the screen happens to be
 * showing. "받을돈 중 맥북에어 몫이 얼마" is a level, and answering it
 * for August alone would report someone as settled up because they
 * happened not to pay this month. `from` exists only to honour an
 * account's own start date.
 *
 * Zero balances are dropped: a counterparty who has settled up
 * contributes nothing to the total, so removing the row cannot move it —
 * the same test the balance sheet applies to retired accounts.
 */
export async function getCounterpartyBalances(
  db: Db,
  params: {
    sectionId: string;
    accountId: string;
    group: AccountGroup;
    /** The account's start date, when it has one. */
    from?: string | null;
    asOf: string;
    untitledLabel: string;
  },
): Promise<CounterpartyBalance[]> {
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
        lte(transactions.date, params.asOf),
      ),
    )
    .groupBy(transactions.title);

  // Merged after the query rather than in it: an empty title and a title
  // of whitespace are the same counterparty to a reader, and SQL would
  // group them apart.
  const byName = new Map<string, number>();
  for (const row of rows) {
    const name = row.title.trim() || params.untitledLabel;
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
  },
): Promise<RunningBalance[]> {
  if (params.transactionIds.length === 0) return [];

  const { account } = params;
  const column = account ? transactionLines.amount : transactionLines.baseAmount;
  const delta = sql<number>`sum(case when ${transactionLines.side} = 'left' then ${column} else -${column} end)`;

  const scope = account
    ? sql`${transactionLines.accountId} = ${account.id}`
    : sql`${accounts.group} in ('asset', 'liability')`;

  const rows = await db.all<{ id: string; running: number }>(sql`
    with tx_delta as (
      select ${transactions.id} as id,
             ${transactions.date} as date,
             ${transactions.createdAt} as created_at,
             ${delta} as delta
      from ${transactionLines}
      inner join ${transactions} on ${transactionLines.transactionId} = ${transactions.id}
      inner join ${accounts} on ${transactionLines.accountId} = ${accounts.id}
      where ${transactions.sectionId} = ${params.sectionId} and ${scope}
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
 * Distinct 적요 from recent transactions, most recent first, each
 * carrying the pair of accounts it was last posted between.
 *
 * Most entries are repeats — 「점심」 out of 식비 and onto 신용카드 for
 * the hundredth time — so the 적요 is enough to know the rest. Picking
 * one fills the two sides and leaves the amount alone, which is the only
 * part that actually differs.
 *
 * Reduced in JS over a window of recent transactions rather than by a
 * GROUP BY: "the accounts of the *latest* transaction with this title"
 * is a per-group argmax, which SQLite can only express with a
 * correlated subquery or a window function, and the window here is small
 * enough that reading it is cheaper than either.
 *
 * Splits contribute their 적요 but no accounts — a suggestion cannot say
 * which of four legs to fill, and half-filling a form is worse than
 * filling none of it.
 */
export async function getTitleSuggestions(
  db: Db,
  params: { sectionId: string; scan?: number; limit?: number },
): Promise<TitleSuggestion[]> {
  const rows = await db.query.transactions.findMany({
    where: eq(transactions.sectionId, params.sectionId),
    orderBy: [desc(transactions.date), desc(transactions.createdAt), desc(transactions.id)],
    limit: params.scan ?? 300,
    columns: { title: true },
    with: { lines: { columns: { side: true, accountId: true } } },
  });

  const byTitle = new Map<string, TitleSuggestion>();
  for (const row of rows) {
    const title = row.title.trim();
    if (!title || byTitle.has(title)) continue;
    const left = row.lines.filter((l) => l.side === "left");
    const right = row.lines.filter((l) => l.side === "right");
    const simple = left.length === 1 && right.length === 1;
    byTitle.set(title, {
      title,
      leftAccountId: simple ? left[0].accountId : null,
      rightAccountId: simple ? right[0].accountId : null,
    });
    if (byTitle.size >= (params.limit ?? 50)) break;
  }
  return [...byTitle.values()];
}
