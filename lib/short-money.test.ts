import { describe, expect, it } from "vitest";
import { formatShortMoney } from "./short-money";

const ko = (minor: number) => formatShortMoney(minor, "KRW", "ko");
const en = (minor: number) => formatShortMoney(minor, "USD", "en");

describe("formatShortMoney", () => {
  it("counts Korean in powers of ten thousand", () => {
    expect(ko(3_247_105_906)).toBe("32.47억");
    expect(ko(132_000_000)).toBe("1.32억");
    expect(ko(5_000_000)).toBe("500만");
    expect(ko(12_500_000_000_000)).toBe("12.5조");
  });

  it("counts English in powers of a thousand", () => {
    // USD, so the minor units are cents.
    expect(en(324_710_590_6)).toBe("32.47M");
    expect(en(1_500_00)).toBe("1.5K");
    expect(en(2_000_000_000_00)).toBe("2B");
  });

  it("picks the unit by what will be printed, not by what was measured", () => {
    // 99,999,999원 is 0.99999999억 and so strictly fills no 억 at all —
    // but it *prints* as 1억, and falling through to 10000만 to avoid
    // saying so would be worse on both counts.
    expect(ko(99_999_999)).toBe("1억");
    expect(ko(100_000_000)).toBe("1억");
    expect(ko(99_999)).toBe("10만");
    expect(ko(9_999)).toBe("1만");
  });

  it("says nothing rather than 0.3만 for a figure below the smallest unit", () => {
    // The caller already has the plain number, and 3,000원 said as a
    // fraction of 만 is harder to read than 3,000원.
    expect(ko(4_999)).toBeNull();
    expect(ko(3_000)).toBeNull();
    expect(ko(0)).toBeNull();
    expect(en(99_9)).toBeNull();
  });

  it("drops a decimal that carries nothing", () => {
    expect(ko(200_000_000)).toBe("2억");
    expect(ko(250_000_000)).toBe("2.5억");
    expect(ko(253_000_000)).toBe("2.53억");
  });

  it("rounds to two places rather than truncating", () => {
    expect(ko(256_000_000)).toBe("2.56억");
    expect(ko(255_500_000)).toBe("2.56억");
    expect(ko(254_900_000)).toBe("2.55억");
  });

  it("keeps a negative figure negative", () => {
    expect(ko(-320_000_000)).toBe("-3.2억");
    expect(ko(-5_000)).toBeNull();
  });

  it("counts in the reader's language, not the currency's country", () => {
    // A Korean reader looking at dollars still counts in 만·억.
    expect(formatShortMoney(324_710_590_6, "USD", "ko")).toBe("3247.11만");
    expect(formatShortMoney(3_247_105_906, "KRW", "en")).toBe("3.25B");
  });

  it("falls back to thousands for a language it does not know", () => {
    expect(formatShortMoney(3_247_105_906, "KRW", "fr")).toBe("3.25B");
  });
});
