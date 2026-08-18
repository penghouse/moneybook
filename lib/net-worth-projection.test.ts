import { describe, expect, it } from "vitest";
import { projectNetWorth } from "./net-worth-projection";
import type { MonthlySaving } from "./savings";

const sheet = (yearMonth: string, assets: number, liabilities: number) => ({
  yearMonth,
  assets,
  liabilities,
  netWorth: assets - liabilities,
});

const budget = (month: string, saving: number): MonthlySaving => ({
  month,
  income: saving > 0 ? saving : 0,
  expense: saving < 0 ? -saving : 0,
  saving,
  source: "budget",
  blank: false,
});

const nothing = (month: string): MonthlySaving => ({
  month,
  income: 0,
  expense: 0,
  saving: 0,
  source: "budget",
  blank: true,
});

describe("projectNetWorth", () => {
  it("leaves the months the ledger speaks for exactly as they were", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-06", 1000, 400), sheet("2026-07", 1200, 400)],
      savings: [],
      currentMonth: "2026-07",
    });

    expect(rows).toEqual([
      { yearMonth: "2026-06", assets: 1000, liabilities: 400, netWorth: 600, projected: false },
      { yearMonth: "2026-07", assets: 1200, liabilities: 400, netWorth: 800, projected: false },
    ]);
  });

  it("carries the budget forward from the last actual month", () => {
    const rows = projectNetWorth({
      history: [
        sheet("2026-07", 1200, 400),
        sheet("2026-08", 1200, 400),
        sheet("2026-09", 1200, 400),
      ],
      savings: [budget("2026-08", 150), budget("2026-09", 250)],
      currentMonth: "2026-07",
    });

    // 800 + 150, then + 250.
    expect(rows.map((r) => r.netWorth)).toEqual([800, 950, 1200]);
    expect(rows.map((r) => r.projected)).toEqual([false, true, true]);
  });

  it("says nothing about assets and liabilities ahead of now", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-07", 1200, 400), sheet("2026-08", 1200, 400)],
      savings: [budget("2026-08", 150)],
      currentMonth: "2026-07",
    });

    // The balance sheet carried 1200/400 forward; the future keeps none
    // of it, because nothing has happened there yet.
    expect(rows[1].assets).toBeNull();
    expect(rows[1].liabilities).toBeNull();
  });

  it("does not apply the current month's own budget, which is half in the ledger already", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-08", 1200, 400), sheet("2026-09", 1200, 400)],
      savings: [budget("2026-08", 999), budget("2026-09", 100)],
      currentMonth: "2026-08",
    });

    expect(rows[0].netWorth).toBe(800);
    expect(rows[1].netWorth).toBe(900);
  });

  it("stops where the budget stops rather than running on flat", () => {
    const rows = projectNetWorth({
      history: [
        sheet("2026-07", 1000, 0),
        sheet("2026-08", 1000, 0),
        sheet("2026-09", 1000, 0),
        sheet("2026-10", 1000, 0),
      ],
      savings: [budget("2026-08", 100), nothing("2026-09"), nothing("2026-10")],
      currentMonth: "2026-07",
    });

    expect(rows.map((r) => r.netWorth)).toEqual([1000, 1100, null, null]);
  });

  it("bridges a gap in the middle at no change, because the budget still reaches past it", () => {
    const rows = projectNetWorth({
      history: [
        sheet("2026-07", 1000, 0),
        sheet("2026-08", 1000, 0),
        sheet("2026-09", 1000, 0),
        sheet("2026-10", 1000, 0),
      ],
      savings: [budget("2026-08", 100), nothing("2026-09"), budget("2026-10", 300)],
      currentMonth: "2026-07",
    });

    expect(rows.map((r) => r.netWorth)).toEqual([1000, 1100, 1100, 1400]);
  });

  it("draws no dotted line at all when nothing ahead is budgeted", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-07", 1000, 0), sheet("2026-08", 1000, 0)],
      savings: [nothing("2026-08")],
      currentMonth: "2026-07",
    });

    expect(rows[1].netWorth).toBeNull();
  });

  it("keeps a negative budget month negative", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-07", 1000, 0), sheet("2026-08", 1000, 0)],
      savings: [budget("2026-08", -250)],
      currentMonth: "2026-07",
    });

    expect(rows[1].netWorth).toBe(750);
  });

  it("anchors on the carried balance when the whole range is ahead of us", () => {
    // Every month is in the future, so the balance sheet reports today's
    // figure for all of them — the first row is the anchor, not a point.
    const rows = projectNetWorth({
      history: [sheet("2026-09", 1000, 0), sheet("2026-10", 1000, 0)],
      savings: [budget("2026-09", 100), budget("2026-10", 200)],
      currentMonth: "2026-07",
    });

    expect(rows.map((r) => r.netWorth)).toEqual([1100, 1300]);
    expect(rows.every((r) => r.projected)).toBe(true);
  });

  it("has nothing to say about an empty range", () => {
    expect(projectNetWorth({ history: [], savings: [], currentMonth: "2026-07" })).toEqual([]);
  });
});
