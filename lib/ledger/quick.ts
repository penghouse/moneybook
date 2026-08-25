import { and, eq, gte } from "drizzle-orm";
import { accounts, transactionLines, transactions } from "@/db/schema";
import type { Db } from "@/db/types";
import { addMonths, monthRange } from "../date";
import { toMajorUnits } from "../money";
import {
  buildQuickEntries,
  QUICK_ENTRY_WINDOW,
  type QuickEntry,
  type QuickEntryOccurrence,
} from "../quick-entries";

/**
 * The one-tap repeats the entry form offers, worked out from the book
 * itself.
 *
 * One scan of a few months of transactions with their legs, folded in
 * memory. The window is small by construction — seven months of a
 * personal ledger — so this is a read of a few hundred rows rather than
 * something that wants its own aggregate.
 *
 * Only two-legged entries are considered. A split cannot say which of
 * its legs a repeat meant, which is the same line the 적요 suggestions
 * already draw, and the amount would be ambiguous besides.
 */
export async function getQuickEntries(
  db: Db,
  params: { sectionId: string; currentMonth: string; limit?: number },
): Promise<QuickEntry[]> {
  const from = monthRange(addMonths(params.currentMonth, -QUICK_ENTRY_WINDOW)).from;

  const rows = await db
    .select({
      transactionId: transactions.id,
      title: transactions.title,
      date: transactions.date,
      side: transactionLines.side,
      accountId: transactionLines.accountId,
      amount: transactionLines.amount,
      currency: transactionLines.currency,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(and(eq(transactions.sectionId, params.sectionId), gte(transactions.date, from)));

  interface Draft {
    title: string;
    date: string;
    left: { accountId: string; amount: number; currency: string }[];
    right: { accountId: string; amount: number; currency: string }[];
  }
  const byTransaction = new Map<string, Draft>();
  for (const row of rows) {
    const draft = byTransaction.get(row.transactionId) ?? {
      title: row.title,
      date: row.date,
      left: [],
      right: [],
    };
    draft[row.side === "left" ? "left" : "right"].push({
      accountId: row.accountId,
      amount: row.amount,
      currency: row.currency,
    });
    byTransaction.set(row.transactionId, draft);
  }

  const occurrences: QuickEntryOccurrence[] = [];
  for (const draft of byTransaction.values()) {
    if (draft.left.length !== 1 || draft.right.length !== 1) continue;
    const [left] = draft.left;
    occurrences.push({
      title: draft.title,
      month: draft.date.slice(0, 7),
      date: draft.date,
      leftAccountId: left.accountId,
      rightAccountId: draft.right[0].accountId,
      // The left leg's own currency, which is what the amount box takes:
      // the form types one figure and both legs wear it.
      amountMajor: toMajorUnits(left.amount, left.currency),
    });
  }

  return buildQuickEntries({
    occurrences,
    currentMonth: params.currentMonth,
    limit: params.limit,
  });
}
