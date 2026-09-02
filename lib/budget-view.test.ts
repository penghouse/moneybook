import { describe, expect, it } from "vitest";
import {
  budgetBarPercent,
  budgetFigures,
  budgetOverBy,
  budgetProgress,
  summaryBelongs,
} from "./budget-view";

describe("budgetProgress", () => {
  it("reports what is left and how much of the budget is used", () => {
    expect(budgetProgress(30_000, 100_000)).toEqual({ left: 70_000, percent: 30, over: false });
  });

  it("says nothing about a budget nobody set", () => {
    expect(budgetProgress(30_000, undefined)).toEqual({ left: null, percent: null, over: false });
  });

  it("tells a budget of zero from no budget at all", () => {
    // 「이 항목엔 쓰지 않는다」 is a real plan. It is the *share* that is
    // undefined, not the budget.
    expect(budgetProgress(0, 0)).toEqual({ left: 0, percent: null, over: false });
    expect(budgetProgress(1_000, 0)).toMatchObject({ left: -1_000, percent: null, over: true });
  });

  it("goes over the moment the budget is passed", () => {
    expect(budgetProgress(100_001, 100_000)).toMatchObject({ over: true, left: -1 });
    expect(budgetProgress(100_000, 100_000)).toMatchObject({ over: false, left: 0 });
  });

  it("handles a refund putting spend below zero", () => {
    expect(budgetProgress(-5_000, 100_000)).toMatchObject({ percent: -5, over: false });
  });
});

describe("budgetBarPercent", () => {
  it("is the share while within budget", () => {
    expect(budgetBarPercent(budgetProgress(30_000, 100_000))).toBe(30);
  });

  it("fills once over, however far over", () => {
    expect(budgetBarPercent(budgetProgress(400_000, 100_000))).toBe(100);
    expect(budgetBarPercent(budgetProgress(1_000, 0))).toBe(100);
  });

  it("never draws backwards", () => {
    expect(budgetBarPercent(budgetProgress(-5_000, 100_000))).toBe(0);
  });

  it("is empty where nothing was budgeted", () => {
    expect(budgetBarPercent(budgetProgress(30_000, undefined))).toBe(0);
  });
});

describe("budgetOverBy", () => {
  it("says how far past the budget it went, as an overshoot", () => {
    // 「초과 ₩24,000」 — positive, because that is how it reads. The same
    // fact with the sign the other way round is what `left` is for.
    expect(budgetOverBy(budgetProgress(124_000, 100_000))).toBe(24_000);
  });

  it("says nothing about a budget that held", () => {
    expect(budgetOverBy(budgetProgress(90_000, 100_000))).toBeNull();
    expect(budgetOverBy(budgetProgress(100_000, 100_000))).toBeNull();
  });

  it("says nothing where there was no budget to go past", () => {
    expect(budgetOverBy(budgetProgress(90_000, undefined))).toBeNull();
  });

  it("counts a single won against a budget of nothing", () => {
    // 「여기엔 쓰지 않는다」 is a plan, and a won spent against it is over
    // by exactly a won.
    expect(budgetOverBy(budgetProgress(1, 0))).toBe(1);
  });
});

describe("budgetFigures", () => {
  const line = (over: string | null) => ({
    actual: "₩744,000",
    budget: "₩620,000",
    overBy: over,
  });

  it("says by how much, not merely that it went over", () => {
    expect(budgetFigures(line("₩124,000"), "초과")).toBe("₩744,000 / ₩620,000 · 초과 ₩124,000");
  });

  it("says the two figures and stops where the budget held", () => {
    expect(budgetFigures(line(null), "초과")).toBe("₩744,000 / ₩620,000");
  });

  it("has only the one figure where nothing was budgeted", () => {
    expect(budgetFigures({ actual: "₩744,000", budget: null, overBy: null }, "초과")).toBe(
      "₩744,000",
    );
  });
});

describe("summaryBelongs", () => {
  it("belongs when nothing was left out", () => {
    expect(summaryBelongs(2, 2)).toBe(true);
    expect(summaryBelongs(1, 1)).toBe(true);
  });

  it("does not belong once a side is dropped", () => {
    // 저축 is 수입 − 지출; a picture of one side cannot add up to it.
    expect(summaryBelongs(1, 2)).toBe(false);
  });

  it("does not belong to a picture of nothing", () => {
    expect(summaryBelongs(0, 0)).toBe(false);
  });
});
