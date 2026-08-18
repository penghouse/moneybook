import { toMajorUnits } from "./money";

/**
 * A big figure said the short way — 32.47억, 3.25B.
 *
 * Nine digits of Korean won is a number nobody reads; they count the
 * commas instead. The short form is what a person would actually say out
 * loud, and it is what makes a roadmap of forty years comparable at a
 * glance rather than digit by digit.
 *
 * The units follow the *currency*, not the reader's language. 원 counts
 * in powers of ten thousand (만·억·조) because that is how the amount
 * itself is spoken and written; every other currency here counts in
 * powers of a thousand. A Korean reader looking at dollars still reads
 * 32.47M, because that is what the figure is called.
 */
interface Unit {
  /** In major units — 억 is 100,000,000 won, M is 1,000,000 dollars. */
  value: number;
  suffix: string;
}

/** Largest first, which is the order the search wants. */
const KRW_UNITS: readonly Unit[] = [
  { value: 1e12, suffix: "조" },
  { value: 1e8, suffix: "억" },
  { value: 1e4, suffix: "만" },
];

const SI_UNITS: readonly Unit[] = [
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "K" },
];

/**
 * Two decimals at most, and no trailing zeros: 1.5억 rather than 1.50억,
 * 2억 rather than 2.00억. A zero that carries no information is one more
 * character between the reader and the number.
 */
function round2(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The largest unit the figure fills at least one of, or nothing at all
 * when it fills none.
 *
 * Returning null rather than falling back to the smallest unit is the
 * point: 3,000원 is not 0.3만, and saying so would be less readable than
 * the plain number the caller already has.
 */
export function formatShortMoney(minorAmount: number, currency: string): string | null {
  const major = toMajorUnits(minorAmount, currency);
  const size = Math.abs(major);
  const units = currency.toUpperCase() === "KRW" ? KRW_UNITS : SI_UNITS;

  for (const unit of units) {
    // Rounded first, so 99,999,999원 reads as 1억 rather than falling
    // through to 10000만 — the unit is chosen by what will be *printed*,
    // not by what was measured.
    if (Math.round((size / unit.value) * 100) / 100 >= 1) {
      return `${round2(major / unit.value)}${unit.suffix}`;
    }
  }
  return null;
}
