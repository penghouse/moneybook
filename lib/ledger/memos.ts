import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { accounts, transactionLines, transactions } from "@/db/schema";
import type { Db } from "@/db/types";

export interface AccountMemo {
  accountId: string;
  date: string;
  /** What was typed in the memo box, trimmed. Never empty. */
  memo: string;
  /** The 적요 it was written on, which may be empty. */
  title: string;
}

/**
 * The memos written on a period's transactions, account by account.
 *
 * 「이 지출이 뭐였지」 could already be answered by opening the account's
 * transactions, and the memo was sitting there when you arrived. But
 * that is a screen away, and the question comes up while reading the
 * budget — which is exactly where the answer was not.
 *
 * Only lines on the account carry the memo to it, so a split that
 * touches four accounts shows its memo under each of the four. That is
 * right: the memo describes the transaction, and the transaction is on
 * all four.
 *
 * One query for the whole period rather than one per row: a month of two
 * dozen budgeted items is otherwise two dozen round trips for something
 * the database says once.
 */
export async function getAccountMemos(
  db: Db,
  params: { sectionId: string; from: string; to: string; limitPerAccount?: number },
): Promise<Map<string, AccountMemo[]>> {
  const limit = params.limitPerAccount ?? 6;

  const rows = await db
    .selectDistinct({
      accountId: transactionLines.accountId,
      date: transactions.date,
      memo: transactions.memo,
      title: transactions.title,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(
      and(
        eq(transactions.sectionId, params.sectionId),
        gte(transactions.date, params.from),
        lte(transactions.date, params.to),
        // 자산·부채 have no budget row to sit under, so their memos are
        // fetched by nobody and need not be carried across.
        inArray(accounts.group, ["income", "expense"]),
        ne(sql`trim(coalesce(${transactions.memo}, ''))`, ""),
      ),
    )
    .orderBy(desc(transactions.date), asc(transactions.id));

  const byAccount = new Map<string, AccountMemo[]>();
  for (const row of rows) {
    const memo = row.memo?.trim();
    if (!memo) continue;
    const bucket = byAccount.get(row.accountId) ?? [];
    // Capped per account, newest first. A row that grew to forty lines
    // would push the figures it belongs to off the screen, and the
    // account's own transaction list is one tap away for the rest.
    if (bucket.length >= limit) continue;
    bucket.push({ accountId: row.accountId, date: row.date, memo, title: row.title });
    byAccount.set(row.accountId, bucket);
  }
  return byAccount;
}
