import type { Db } from "@/db/types";
import { getOrFetchRate, RateUnavailableError } from "../exchange-rates";
import { convertMinorUnits } from "../money";
import { getAccountBalances } from "./account-nets";

interface UnrealizedFxBase {
  accountId: string;
  name: string;
  currency: string;
  /** Signed, own-currency minor units — normal-balance direction. */
  amount: number;
  /** Signed, base-currency minor units, fixed at each transaction's own rate. */
  bookBaseAmount: number;
}

export type UnrealizedFx = UnrealizedFxBase &
  (
    | {
        rateUnavailable: false;
        /** Signed, base-currency minor units, at asOf's rate. */
        currentBaseAmount: number;
        unrealized: number;
        rateDate: string;
        isFallback: boolean;
      }
    /**
     * No rate could be fetched or fallen back to for this currency. The
     * account's book value is still known and still counts toward the
     * balance sheet totals, so this is reported rather than thrown —
     * a missing rate must never take down the whole page.
     */
    | { rateUnavailable: true }
  );

/** An entry whose current value is known — the only kind that can be revalued. */
export type ResolvedUnrealizedFx = Extract<UnrealizedFx, { rateUnavailable: false }>;

/**
 * For every foreign-currency account with a nonzero balance, compares
 * its recorded (book) base-currency value against what it's worth at
 * asOf's exchange rate. The gap is what a "환율 반영" revaluation would
 * post — this function only reads, it never writes.
 *
 * Balance-sheet totals are always book value (fixed at each
 * transaction's own rate), so nothing here feeds them; a currency whose
 * rate is unavailable simply can't show a current value or an
 * unrealized difference until a rate exists.
 */
export async function getUnrealizedFx(
  db: Db,
  params: { sectionId: string; baseCurrency: string; asOf: string },
): Promise<UnrealizedFx[]> {
  const balances = await getAccountBalances(db, {
    sectionId: params.sectionId,
    asOf: params.asOf,
  });
  const foreign = balances.filter((b) => b.currency !== params.baseCurrency && b.amount !== 0);

  const results: UnrealizedFx[] = [];
  for (const b of foreign) {
    const base: UnrealizedFxBase = {
      accountId: b.accountId,
      name: b.name,
      currency: b.currency,
      amount: b.amount,
      bookBaseAmount: b.baseAmount,
    };

    let rate;
    try {
      rate = await getOrFetchRate(db, {
        date: params.asOf,
        base: b.currency,
        quote: params.baseCurrency,
      });
    } catch (error) {
      if (error instanceof RateUnavailableError) {
        results.push({ ...base, rateUnavailable: true });
        continue;
      }
      throw error;
    }

    const currentBaseAmount = convertMinorUnits(
      b.amount,
      rate.rate,
      b.currency,
      params.baseCurrency,
    );
    results.push({
      ...base,
      rateUnavailable: false,
      currentBaseAmount,
      unrealized: currentBaseAmount - b.baseAmount,
      rateDate: rate.date,
      isFallback: rate.isFallback,
    });
  }
  return results;
}
