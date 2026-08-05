import { and, desc, eq, lte } from "drizzle-orm";
import { exchangeRates } from "@/db/schema";
import type { Db } from "@/db/types";

const FRANKFURTER_BASE_URL = "https://api.frankfurter.app";

export class RateUnavailableError extends Error {}

export interface RateResult {
  rate: number;
  source: "api" | "manual";
  /**
   * The date this rate actually applies to. Can differ from the
   * requested date: the API may echo back the last business day (a
   * requested date falls on a weekend/holiday), or this may be a
   * fallback to the most recent cached rate after an API failure.
   */
  date: string;
  isFallback: boolean;
}

/**
 * Once a (date, base, quote) triple is cached, it is never silently
 * re-fetched or overwritten — a transaction's exchange rate must stay
 * fixed once recorded. Only setManualRate ever overwrites a row.
 */
export async function getOrFetchRate(
  db: Db,
  params: { date: string; base: string; quote: string },
): Promise<RateResult> {
  const { date, base, quote } = params;
  if (base === quote) {
    return { rate: 1, source: "manual", date, isFallback: false };
  }

  const cached = await db.query.exchangeRates.findFirst({
    where: and(
      eq(exchangeRates.date, date),
      eq(exchangeRates.base, base),
      eq(exchangeRates.quote, quote),
    ),
  });
  if (cached) {
    return { rate: cached.rate, source: cached.source, date, isFallback: false };
  }

  const fetched = await fetchFromApi(date, base, quote);
  if (fetched) {
    await db
      .insert(exchangeRates)
      .values({ date: fetched.date, base, quote, rate: fetched.rate, source: "api" })
      .onConflictDoNothing();
    return {
      rate: fetched.rate,
      source: "api",
      date: fetched.date,
      isFallback: fetched.date !== date,
    };
  }

  const fallback = await db.query.exchangeRates.findFirst({
    where: and(
      eq(exchangeRates.base, base),
      eq(exchangeRates.quote, quote),
      lte(exchangeRates.date, date),
    ),
    orderBy: desc(exchangeRates.date),
  });
  if (fallback) {
    return {
      rate: fallback.rate,
      source: fallback.source,
      date: fallback.date,
      isFallback: true,
    };
  }

  throw new RateUnavailableError(
    `No exchange rate available for ${base}->${quote} on or before ${date}`,
  );
}

async function fetchFromApi(
  date: string,
  base: string,
  quote: string,
): Promise<{ rate: number; date: string } | null> {
  try {
    const url = `${FRANKFURTER_BASE_URL}/${date}?from=${base}&to=${quote}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const rate = data.rates?.[quote];
    if (typeof rate !== "number" || typeof data.date !== "string") return null;
    return { rate, date: data.date };
  } catch {
    return null;
  }
}

/** The only path that overwrites an already-cached rate. */
export async function setManualRate(
  db: Db,
  params: { date: string; base: string; quote: string; rate: number },
): Promise<void> {
  await db
    .insert(exchangeRates)
    .values({ ...params, source: "manual" })
    .onConflictDoUpdate({
      target: [exchangeRates.date, exchangeRates.base, exchangeRates.quote],
      set: { rate: params.rate, source: "manual" },
    });
}
