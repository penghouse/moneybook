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
  it("leaves the months the ledger has settled exactly as they were", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-06", 1000, 400), sheet("2026-07", 1200, 400)],
      savings: [],
      currentMonth: "2026-07",
    });

    expect(rows).toEqual([
      {
        yearMonth: "2026-06",
        assets: 1000,
        liabilities: 400,
        netWorth: 600,
        ahead: false,
        expected: null,
      },
      {
        yearMonth: "2026-07",
        assets: 1200,
        liabilities: 400,
        netWorth: 800,
        ahead: false,
        expected: null,
      },
    ]);
  });

  it("keeps the ledger's own figures for the months ahead, and marks them unsettled", () => {
    // A transaction can be dated in advance, so a future month is not
    // empty — it is just not settled. The balance sheet's answer stands.
    const rows = projectNetWorth({
      history: [sheet("2026-07", 1200, 400), sheet("2026-08", 1500, 400)],
      savings: [budget("2026-08", 150)],
      currentMonth: "2026-07",
    });

    expect(rows[1].assets).toBe(1500);
    expect(rows[1].liabilities).toBe(400);
    expect(rows[1].netWorth).toBe(1100);
    expect(rows.map((r) => r.ahead)).toEqual([false, true]);
  });

  it("carries the budget forward from the last settled month, beside the ledger's line", () => {
    const rows = projectNetWorth({
      history: [
        sheet("2026-07", 1200, 400),
        sheet("2026-08", 1200, 400),
        sheet("2026-09", 1200, 400),
      ],
      savings: [budget("2026-08", 150), budget("2026-09", 250)],
      currentMonth: "2026-07",
    });

    // The forecast leaves from 800 — the anchor is the settled month
    // itself, so the two lines meet rather than start apart.
    expect(rows.map((r) => r.expected)).toEqual([800, 950, 1200]);
    expect(rows.map((r) => r.netWorth)).toEqual([800, 800, 800]);
  });

  it("does not apply the current month's own budget, which is half in the ledger already", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-08", 1200, 400), sheet("2026-09", 1200, 400)],
      savings: [budget("2026-08", 999), budget("2026-09", 100)],
      currentMonth: "2026-08",
    });

    expect(rows[0].expected).toBe(800);
    expect(rows[1].expected).toBe(900);
  });

  it("stops the forecast where the budget stops rather than running on flat", () => {
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

    expect(rows.map((r) => r.expected)).toEqual([1000, 1100, null, null]);
    // The ledger's line is untouched by any of that.
    expect(rows.map((r) => r.netWorth)).toEqual([1000, 1000, 1000, 1000]);
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

    expect(rows.map((r) => r.expected)).toEqual([1000, 1100, 1100, 1400]);
  });

  it("draws no forecast at all — not even its anchor — when nothing ahead is budgeted", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-07", 1000, 0), sheet("2026-08", 1000, 0)],
      savings: [nothing("2026-08")],
      currentMonth: "2026-07",
    });

    expect(rows.map((r) => r.expected)).toEqual([null, null]);
    // The chart still has the ledger's own months to draw.
    expect(rows[1].ahead).toBe(true);
  });

  it("keeps a negative budget month negative", () => {
    const rows = projectNetWorth({
      history: [sheet("2026-07", 1000, 0), sheet("2026-08", 1000, 0)],
      savings: [budget("2026-08", -250)],
      currentMonth: "2026-07",
    });

    expect(rows[1].expected).toBe(750);
  });

  it("anchors on the carried balance when the whole range is ahead of us", () => {
    // Every month is in the future, so there is no settled month to leave
    // from — the balance carried into the range is what the first row
    // already reports, and that is the anchor.
    const rows = projectNetWorth({
      history: [sheet("2026-09", 1000, 0), sheet("2026-10", 1000, 0)],
      savings: [budget("2026-09", 100), budget("2026-10", 200)],
      currentMonth: "2026-07",
    });

    expect(rows.map((r) => r.expected)).toEqual([1100, 1300]);
    expect(rows.every((r) => r.ahead)).toBe(true);
  });

  it("has nothing to say about an empty range", () => {
    expect(projectNetWorth({ history: [], savings: [], currentMonth: "2026-07" })).toEqual([]);
  });
});
