import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { ACCOUNT_CSV_COLUMNS } from "@/lib/csv";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
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

  const allAccounts = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
    orderBy: asc(accounts.sortOrder),
  });

  return csvStreamResponse({
    filename: "accounts.csv",
    columns: ACCOUNT_CSV_COLUMNS,
    rows: allAccounts,
    toCells: (a) => [
      a.group,
      a.name,
      a.currency,
      a.activeFrom ?? "",
      a.activeTo ?? "",
      a.memo ?? "",
      a.category ?? "",
      a.tracksCounterparties ? "1" : "",
    ],
  });
}
