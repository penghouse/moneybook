import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-client";
import { exchangeRates } from "@/db/schema";
import type { Db } from "@/db/types";
import { getOrFetchRate, RateUnavailableError, setManualRate } from "./exchange-rates";

function mockFetchOnce(body: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("getOrFetchRate", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 1 for a same-currency pair without touching the network", async () => {
    const fetchMock = mockFetchOnce({});
    const result = await getOrFetchRate(db, { date: "2026-07-31", base: "KRW", quote: "KRW" });
    expect(result).toEqual({ rate: 1, source: "manual", date: "2026-07-31", isFallback: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and caches on a cold lookup", async () => {
    const fetchMock = mockFetchOnce({ date: "2026-07-31", rates: { KRW: 1300 } });

    const result = await getOrFetchRate(db, { date: "2026-07-31", base: "USD", quote: "KRW" });
    expect(result).toEqual({ rate: 1300, source: "api", date: "2026-07-31", isFallback: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const row = await db.query.exchangeRates.findFirst({
      where: eq(exchangeRates.date, "2026-07-31"),
    });
    expect(row).toMatchObject({ base: "USD", quote: "KRW", rate: 1300, source: "api" });
  });

  it("never re-fetches once a date is cached", async () => {
    const fetchMock = mockFetchOnce({ date: "2026-07-31", rates: { KRW: 1300 } });
    await getOrFetchRate(db, { date: "2026-07-31", base: "USD", quote: "KRW" });
    await getOrFetchRate(db, { date: "2026-07-31", base: "USD", quote: "KRW" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a fallback when the API echoes an earlier date (e.g. a weekend)", async () => {
    mockFetchOnce({ date: "2026-07-31", rates: { KRW: 1300 } }); // Friday, requested Saturday
    const result = await getOrFetchRate(db, { date: "2026-08-01", base: "USD", quote: "KRW" });
    expect(result).toEqual({ rate: 1300, source: "api", date: "2026-07-31", isFallback: true });
  });

  it("falls back to the most recent cached rate when the API is unreachable", async () => {
    await db.insert(exchangeRates).values({
      date: "2026-07-20",
      base: "USD",
      quote: "KRW",
      rate: 1290,
      source: "api",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await getOrFetchRate(db, { date: "2026-07-31", base: "USD", quote: "KRW" });
    expect(result).toEqual({ rate: 1290, source: "api", date: "2026-07-20", isFallback: true });
  });

  it("never silently defaults to 1.0 when nothing is cached and the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(
      getOrFetchRate(db, { date: "2026-07-31", base: "USD", quote: "KRW" }),
    ).rejects.toThrow(RateUnavailableError);
  });

  it("treats a non-2xx API response the same as a network failure", async () => {
    mockFetchOnce({}, false);
    await expect(
      getOrFetchRate(db, { date: "2026-07-31", base: "USD", quote: "KRW" }),
    ).rejects.toThrow(RateUnavailableError);
  });
});

describe("setManualRate", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("inserts a new manual rate", async () => {
    await setManualRate(db, { date: "2026-07-31", base: "USD", quote: "KRW", rate: 1310 });
    const row = await db.query.exchangeRates.findFirst({
      where: eq(exchangeRates.date, "2026-07-31"),
    });
    expect(row).toMatchObject({ rate: 1310, source: "manual" });
  });

  it("overwrites an existing api-sourced rate for the same date", async () => {
    await db.insert(exchangeRates).values({
      date: "2026-07-31",
      base: "USD",
      quote: "KRW",
      rate: 1300,
      source: "api",
    });
    await setManualRate(db, { date: "2026-07-31", base: "USD", quote: "KRW", rate: 1315 });

    const row = await db.query.exchangeRates.findFirst({
      where: eq(exchangeRates.date, "2026-07-31"),
    });
    expect(row).toMatchObject({ rate: 1315, source: "manual" });
  });
});
