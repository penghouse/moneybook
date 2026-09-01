import { describe, expect, it } from "vitest";
import { budgetBarPercent, budgetProgress } from "./budget-view";

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
