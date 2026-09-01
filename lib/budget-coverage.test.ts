import { describe, expect, it } from "vitest";
import { budgetableMonths, monthsCoverYear } from "./budget-coverage";

const always = { activeFrom: null, activeTo: null };
const months = (year: string, ...nums: number[]) =>
  new Set(nums.map((n) => `${year}-${String(n).padStart(2, "0")}`));
const all = (year: string) => months(year, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);

describe("budgetableMonths", () => {
  it("is the whole year for an account with no window", () => {
    expect(budgetableMonths("2026", always)).toHaveLength(12);
  });

  it("starts at the month the account opened in, not the one after", () => {
    // Opened on the 20th of June: June is still a month it was spent in.
    const opened = { activeFrom: "2026-06-20", activeTo: null };
    expect(budgetableMonths("2026", opened)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
  });

  it("ends at the month it closed in", () => {
    const closed = { activeFrom: null, activeTo: "2026-03-02" };
    expect(budgetableMonths("2026", closed)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("is empty for a year the account was not open in at all", () => {
    expect(budgetableMonths("2026", { activeFrom: "2027-01-01", activeTo: null })).toEqual([]);
  });
});

describe("monthsCoverYear", () => {
  it("is covered when all twelve are set", () => {
    expect(monthsCoverYear({ year: "2026", account: always, budgeted: all("2026") })).toBe(true);
  });

  it("is not covered with a gap in the middle", () => {
    const budgeted = all("2026");
    budgeted.delete("2026-07");
    expect(monthsCoverYear({ year: "2026", account: always, budgeted })).toBe(false);
  });

  it("holds a part-year account only to the months it was open in", () => {
    const opened = { activeFrom: "2026-06-20", activeTo: null };
    expect(
      monthsCoverYear({
        year: "2026",
        account: opened,
        budgeted: months("2026", 6, 7, 8, 9, 10, 11, 12),
      }),
    ).toBe(true);
  });

  it("still wants every one of those months", () => {
    const opened = { activeFrom: "2026-06-20", activeTo: null };
    expect(
      monthsCoverYear({
        year: "2026",
        account: opened,
        budgeted: months("2026", 6, 7, 8, 9, 10, 11),
      }),
    ).toBe(false);
  });

  it("ignores months of another year", () => {
    expect(monthsCoverYear({ year: "2026", account: always, budgeted: all("2025") })).toBe(false);
  });

  it("is not covered when the account was never open — there is nothing to cover", () => {
    expect(
      monthsCoverYear({
        year: "2026",
        account: { activeFrom: "2027-01-01", activeTo: null },
        budgeted: all("2026"),
      }),
    ).toBe(false);
  });

  it("is not covered by an empty set", () => {
    expect(monthsCoverYear({ year: "2026", account: always, budgeted: new Set() })).toBe(false);
  });
});
