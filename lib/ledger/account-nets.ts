import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { accounts, transactionLines, transactions, type AccountGroup } from "@/db/schema";
import type { Db } from "@/db/types";
import { normalBalance } from "./normal-balance";

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
