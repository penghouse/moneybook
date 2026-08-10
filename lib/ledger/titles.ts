import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { transactionLines, transactions, type AccountGroup, type LineSide } from "@/db/schema";
import type { Db } from "@/db/types";
import { bareTitle } from "../titles";
import { normalBalance } from "./normal-balance";

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
