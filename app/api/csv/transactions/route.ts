import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { transactionLines, transactions } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { TX_CSV_COLUMNS } from "@/lib/csv";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { toMajorUnits } from "@/lib/money";
import { csvStreamResponse, unauthorizedJson } from "../stream";

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedJson();
  }

  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const txs = await db.query.transactions.findMany({
    where: eq(transactions.sectionId, section.id),
    orderBy: [asc(transactions.date), asc(transactions.id)],
    with: {
      lines: {
        orderBy: asc(transactionLines.lineOrder),
        with: { account: true },
      },
    },
  });

  // Flattened to one row per line; the transaction's own fields repeat
  // on each of its rows and transactionKey ties them back together.
  const flat = txs.flatMap((tx, i) =>
    tx.lines.map((line) => ({ key: `T${String(i + 1).padStart(4, "0")}`, tx, line })),
  );

  return csvStreamResponse({
    filename: "transactions.csv",
    columns: TX_CSV_COLUMNS,
    rows: flat,
    toCells: ({ key, tx, line }) => [
      key,
      tx.date,
      tx.kind,
      tx.title,
      tx.memo ?? "",
      line.side,
      line.account.name,
      line.currency,
      String(toMajorUnits(line.amount, line.currency)),
      line.rate === null ? "" : String(line.rate),
      String(toMajorUnits(line.baseAmount, section.baseCurrency)),
      line.memo ?? "",
    ],
  });
}
