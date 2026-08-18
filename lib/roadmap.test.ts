import { describe, expect, it } from "vitest";
import { buildRoadmap, MAX_ROADMAP_YEARS, type RoadmapOverride } from "./roadmap";

/** Made-up figures, round enough that the arithmetic can be read off the page. */
const base = {
  startYear: "2025",
  endYear: "2028",
  startingAmount: 50_000_000,
  defaultContribution: 6_000_000,
  defaultReturnRate: 0.1,
  overrides: [] as RoadmapOverride[],
};

describe("buildRoadmap", () => {
  it("compounds (시작 + 저축) × (1 + 수익률) into the next year's 시작", () => {
    const rows = buildRoadmap(base);

    // (50,000,000 + 6,000,000) × 1.1
    expect(rows[0].planEnd).toBe(61_600_000);
    expect(rows[1].planStart).toBe(61_600_000);
    expect(rows[1].planEnd).toBe(Math.round((61_600_000 + 6_000_000) * 1.1));
  });

  it("works out what a year actually earned, against what went in", () => {
    const rows = buildRoadmap({
      ...base,
      startYear: "2026",
      endYear: "2026",
      startingAmount: 61_600_000,
      defaultContribution: 6_000_000,
      // 67,600,000 went in and 84,500,000 came out, which is a quarter more.
      actualByYear: new Map([["2026", 84_500_000]]),
    });

    expect(rows[0].actualReturnRate).toBeCloseTo(0.25, 10);
  });

  it("keeps the 계획 track clear of the ledger", () => {
    const withActuals = buildRoadmap({
      ...base,
      actualByYear: new Map([["2025", 1_000]]),
    });
    const withoutActuals = buildRoadmap(base);

    expect(withActuals.map((r) => r.planEnd)).toEqual(withoutActuals.map((r) => r.planEnd));
  });

  it("lets an actual become the 실적 기말, and the next year's 시작", () => {
    const rows = buildRoadmap({
      ...base,
      actualByYear: new Map([["2025", 40_000_000]]),
    });

    expect(rows[0].liveEnd).toBe(40_000_000);
    expect(rows[1].liveStart).toBe(40_000_000);
    // And it carries: 2026 has no actual, so it compounds from the real
    // figure rather than from what the plan wished for.
    expect(rows[1].liveEnd).toBe(Math.round((40_000_000 + 6_000_000) * 1.1));
  });

  it("takes an override for its own year only, and defaults everywhere else", () => {
    const rows = buildRoadmap({
      ...base,
      overrides: [{ year: "2026", contribution: 20_000_000, returnRate: 0.5, note: "이사" }],
    });

    expect(rows[0].contribution).toBe(6_000_000);
    expect(rows[0].overridden).toBe(false);
    expect(rows[1].contribution).toBe(20_000_000);
    expect(rows[1].returnRate).toBe(0.5);
    expect(rows[1].note).toBe("이사");
    expect(rows[1].overridden).toBe(true);
    expect(rows[2].contribution).toBe(6_000_000);
    expect(rows[2].returnRate).toBe(0.1);
  });

  it("falls back per field, so a year may override the note alone", () => {
    const rows = buildRoadmap({
      ...base,
      overrides: [{ year: "2025", contribution: null, returnRate: null, note: "출산" }],
    });

    expect(rows[0].note).toBe("출산");
    expect(rows[0].contribution).toBe(6_000_000);
    expect(rows[0].returnRate).toBe(0.1);
    // A note is still an override — the row exists and can be cleared.
    expect(rows[0].overridden).toBe(true);
  });

  it("leaves 실제수익 blank rather than showing −100% for a year not yet lived", () => {
    const rows = buildRoadmap(base);

    expect(rows.every((r) => r.actual === null)).toBe(true);
    expect(rows.every((r) => r.actualReturnRate === null)).toBe(true);
  });

  it("does not divide by a zero base", () => {
    const rows = buildRoadmap({
      ...base,
      startYear: "2025",
      endYear: "2025",
      startingAmount: 0,
      defaultContribution: 0,
      actualByYear: new Map([["2025", 5_000_000]]),
    });

    expect(rows[0].actual).toBe(5_000_000);
    expect(rows[0].actualReturnRate).toBeNull();
  });

  it("returns nothing when the range runs backwards", () => {
    expect(buildRoadmap({ ...base, startYear: "2030", endYear: "2029" })).toEqual([]);
  });

  it("draws one row for a single-year range", () => {
    const rows = buildRoadmap({ ...base, startYear: "2025", endYear: "2025" });
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe("2025");
  });

  it("caps a range that would run for centuries", () => {
    const rows = buildRoadmap({ ...base, startYear: "2025", endYear: "9999" });
    expect(rows).toHaveLength(MAX_ROADMAP_YEARS);
  });

  it("rounds each year rather than the chain, so the column adds up as printed", () => {
    const rows = buildRoadmap({ ...base, defaultReturnRate: 0.07 });

    for (const row of rows) {
      expect(Number.isInteger(row.planEnd)).toBe(true);
      expect(Number.isInteger(row.liveEnd)).toBe(true);
      expect(row.planEnd).toBe(Math.round((row.planStart + row.contribution) * 1.07));
    }
  });
});
