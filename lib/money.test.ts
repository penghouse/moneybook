import { describe, expect, it } from "vitest";
import {
  convertMinorUnits,
  formatMoney,
  minorUnitDigits,
  toMajorUnits,
  toMinorUnits,
} from "./money";

describe("minorUnitDigits", () => {
  it("gets digit counts from Intl, not a hardcoded table", () => {
    expect(minorUnitDigits("KRW")).toBe(0);
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("USD")).toBe(2);
    expect(minorUnitDigits("BHD")).toBe(3);
  });
});

describe("toMinorUnits / toMajorUnits", () => {
  it("round-trips through minor units", () => {
    expect(toMinorUnits(12.34, "USD")).toBe(1234);
    expect(toMajorUnits(1234, "USD")).toBeCloseTo(12.34);

    expect(toMinorUnits(1_300_000, "KRW")).toBe(1_300_000);
    expect(toMajorUnits(1_300_000, "KRW")).toBe(1_300_000);
  });
});

describe("convertMinorUnits", () => {
  it("converts USD minor units to KRW minor units at a given rate", () => {
    // $1,000.00 @ 1,300 -> ₩1,300,000 (the worked example from the plan)
    expect(convertMinorUnits(100_000, 1300, "USD", "KRW")).toBe(1_300_000);
  });

  it("is exact for a same-currency, rate=1 conversion", () => {
    expect(convertMinorUnits(45_000, 1, "KRW", "KRW")).toBe(45_000);
  });

  it("rounds once at the end rather than compounding", () => {
    // 33.33 USD @ 1345.678 KRW/USD
    expect(convertMinorUnits(3333, 1345.678, "USD", "KRW")).toBe(Math.round(33.33 * 1345.678));
  });
});

describe("formatMoney", () => {
  it("formats using the currency's own symbol regardless of locale", () => {
    expect(formatMoney(1234, "USD", "en-US")).toBe("$12.34");
    expect(formatMoney(1_300_000, "KRW", "en-US")).toContain("1,300,000");
    expect(formatMoney(1_300_000, "KRW", "ko-KR")).toContain("1,300,000");
  });
});
