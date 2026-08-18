import { describe, expect, it } from "vitest";
import { formatShortMoney } from "./short-money";

const won = (minor: number) => formatShortMoney(minor, "KRW");
const usd = (minor: number) => formatShortMoney(minor, "USD");

describe("formatShortMoney", () => {
  it("counts 원 in powers of ten thousand", () => {
    expect(won(3_247_105_906)).toBe("32.47억");
    expect(won(132_000_000)).toBe("1.32억");
    expect(won(5_000_000)).toBe("500만");
    expect(won(12_500_000_000_000)).toBe("12.5조");
  });

  it("counts every other currency in powers of a thousand", () => {
    // USD, so the minor units are cents.
    expect(usd(324_710_590_6)).toBe("32.47M");
    expect(usd(1_500_00)).toBe("1.5K");
    expect(usd(2_000_000_000_00)).toBe("2B");
  });

  it("picks the unit by what will be printed, not by what was measured", () => {
    // 99,999,999원 is 0.99999999억 and so strictly fills no 억 at all —
    // but it *prints* as 1억, and falling through to 10000만 to avoid
    // saying so would be worse on both counts.
    expect(won(99_999_999)).toBe("1억");
    expect(won(100_000_000)).toBe("1억");
    expect(won(99_999)).toBe("10만");
    expect(won(9_999)).toBe("1만");
  });

  it("says nothing rather than 0.3만 for a figure below the smallest unit", () => {
    // The caller already has the plain number, and 3,000원 said as a
    // fraction of 만 is harder to read than 3,000원.
    expect(won(4_999)).toBeNull();
    expect(won(3_000)).toBeNull();
    expect(won(0)).toBeNull();
    expect(usd(99_9)).toBeNull();
  });

  it("drops a decimal that carries nothing", () => {
    expect(won(200_000_000)).toBe("2억");
    expect(won(250_000_000)).toBe("2.5억");
    expect(won(253_000_000)).toBe("2.53억");
  });

  it("rounds to two places rather than truncating", () => {
    expect(won(256_000_000)).toBe("2.56억");
    expect(won(255_500_000)).toBe("2.56억");
    expect(won(254_900_000)).toBe("2.55억");
  });

  it("keeps a negative figure negative", () => {
    expect(won(-320_000_000)).toBe("-3.2억");
    expect(won(-5_000)).toBeNull();
  });

  it("follows the currency, not the reader", () => {
    // Dollars are called 32.47M whoever is reading them, and won are
    // 32.47억 — the unit belongs to the amount, not to the audience.
    expect(formatShortMoney(324_710_590_6, "USD")).toBe("32.47M");
    expect(formatShortMoney(3_247_105_906, "KRW")).toBe("32.47억");
    expect(formatShortMoney(324_710_590_6, "JPY")).toBe("3.25B");
  });

  it("knows won however it is spelled", () => {
    expect(formatShortMoney(3_247_105_906, "krw")).toBe("32.47억");
  });
});
