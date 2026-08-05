import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { budgets } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { BUDGET_CSV_COLUMNS } from "@/lib/csv";
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

  // Keyed by account name rather than id so an exported budget can be
  // restored into a rebuilt book, the same way transactions are.
  const rows = await db.query.budgets.findMany({
    where: eq(budgets.sectionId, section.id),
    orderBy: [asc(budgets.yearMonth)],
    with: { account: true },
  });

  return csvStreamResponse({
    filename: "budgets.csv",
    columns: BUDGET_CSV_COLUMNS,
    rows,
    toCells: (b) => [
      b.account.name,
      b.yearMonth,
      String(toMajorUnits(b.amount, section.baseCurrency)),
    ],
  });
}
