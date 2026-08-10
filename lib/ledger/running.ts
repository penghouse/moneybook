import { sql } from "drizzle-orm";
import { accounts, transactionLines, transactions, type AccountGroup } from "@/db/schema";
import type { Db } from "@/db/types";
import { normalBalance } from "./normal-balance";

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
