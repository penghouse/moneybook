import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { exchangeRates } from "@/db/schema";
import { RATE_CSV_COLUMNS } from "@/lib/csv";
import { requireUserId } from "@/lib/current-user";
import { csvStreamResponse, unauthorizedJson } from "../stream";

export async function GET() {
  try {
    await requireUserId();
  } catch {
    return unauthorizedJson();
  }

  // exchange_rates has no section column — it is a shared cache keyed by
  // (date, base, quote). Manually corrected rates can't be re-derived
  // from the API, so they belong in a backup.
  const rows = await db.query.exchangeRates.findMany({
    orderBy: [asc(exchangeRates.date), asc(exchangeRates.base), asc(exchangeRates.quote)],
  });

  return csvStreamResponse({
    filename: "exchange-rates.csv",
    columns: RATE_CSV_COLUMNS,
    rows,
    toCells: (r) => [r.date, r.base, r.quote, String(r.rate), r.source],
  });
}
