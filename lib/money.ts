/**
 * All money in this app is stored as an integer count of the currency's
 * minor unit (e.g. cents for USD, won for KRW — which has none). Never a
 * float. Digit counts come from Intl, not a hardcoded currency table, so
 * an unusual currency (JPY, BHD, ...) is never silently wrong.
 */

export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function toMinorUnits(majorAmount: number, currency: string): number {
  return Math.round(majorAmount * 10 ** minorUnitDigits(currency));
}

export function toMajorUnits(minorAmount: number, currency: string): number {
  return minorAmount / 10 ** minorUnitDigits(currency);
}

/**
 * Converts a minor-unit amount from one currency to another using a
 * major-unit exchange rate (rate = how many units of `toCurrency` one unit
 * of `fromCurrency` is worth). Rounds once, at the end, so differing
 * decimal precisions (e.g. USD's 2 digits vs KRW's 0) never compound
 * rounding error across two conversions.
 */
export function convertMinorUnits(
  amount: number,
  rate: number,
  fromCurrency: string,
  toCurrency: string,
): number {
  const scale = 10 ** (minorUnitDigits(toCurrency) - minorUnitDigits(fromCurrency));
  return Math.round(amount * rate * scale);
}

export function formatMoney(minorAmount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(toMajorUnits(minorAmount, currency));
}
