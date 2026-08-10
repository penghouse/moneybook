import { and, eq, gte, like as like_, lte, or } from "drizzle-orm";
import { transactionLines, transactions } from "@/db/schema";
import type { Db } from "@/db/types";
import { hasTag, normalizeTag } from "../tags";

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
