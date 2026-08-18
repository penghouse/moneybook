import { describe, expect, it } from "vitest";
import { combineSavings, sumSavings, type MonthlySaving } from "./savings";

const base = {
  currentMonth: "2026-08",
  firstLedgerMonth: "2026-03",
  actualByMonth: new Map([
    ["2026-06", { income: 5_000_000, expense: 3_200_000 }],
    ["2026-07", { income: 5_000_000, expense: 6_100_000 }],
  ]),
  budgetByMonth: new Map([
    ["2026-08", { income: 5_000_000, expense: 3_000_000 }],
    ["2026-09", { income: 5_000_000, expense: 3_000_000 }],
  ]),
};

const byMonth = (rows: MonthlySaving[], month: string) => rows.find((r) => r.month === month)!;

describe("combineSavings", () => {
  it("reads a month that has happened off the ledger", () => {
    const rows = combineSavings({ ...base, months: ["2026-06"] });

    expect(byMonth(rows, "2026-06").source).toBe("actual");
    expect(byMonth(rows, "2026-06").saving).toBe(1_800_000);
  });

  it("keeps a month that spent more than it earned", () => {
    // Not clamped at zero: a month that ate into savings is exactly what
    // the roadmap needs to carry forward.
    expect(byMonth(combineSavings({ ...base, months: ["2026-07"] }), "2026-07").saving).toBe(
      -1_100_000,
    );
  });

  it("reads a month still to come off the budgets", () => {
    const rows = combineSavings({ ...base, months: ["2026-09"] });

    expect(byMonth(rows, "2026-09").source).toBe("budget");
    expect(byMonth(rows, "2026-09").saving).toBe(2_000_000);
  });

  it("treats the month in progress as budget, not as a bad month", () => {
    // Half of August has happened. Its actual total would read as a
    // collapse in income rather than as an unfinished month.
    const rows = combineSavings({
      ...base,
      months: ["2026-08"],
      actualByMonth: new Map([["2026-08", { income: 100, expense: 3_000_000 }]]),
    });

    expect(byMonth(rows, "2026-08").source).toBe("budget");
    expect(byMonth(rows, "2026-08").saving).toBe(2_000_000);
  });

  it("leaves a month before the book begins blank rather than zero", () => {
    const rows = combineSavings({ ...base, months: ["2026-01"] });

    expect(byMonth(rows, "2026-01").blank).toBe(true);
    expect(byMonth(rows, "2026-01").source).toBe("actual");
  });

  it("leaves a month ahead with no budget blank", () => {
    const rows = combineSavings({ ...base, months: ["2027-04"] });

    expect(byMonth(rows, "2027-04").blank).toBe(true);
    expect(byMonth(rows, "2027-04").saving).toBe(0);
  });

  it("counts a lived month with no transactions as a real zero", () => {
    // Inside the book's lifetime and nothing was earned or spent: that
    // is a fact about the month, not a gap in what is known.
    const rows = combineSavings({ ...base, months: ["2026-05"] });

    expect(byMonth(rows, "2026-05").blank).toBe(false);
    expect(byMonth(rows, "2026-05").saving).toBe(0);
  });

  it("has nothing to say about any month of an empty book", () => {
    const rows = combineSavings({ ...base, months: ["2026-06"], firstLedgerMonth: null });

    expect(byMonth(rows, "2026-06").blank).toBe(true);
  });
});

describe("sumSavings", () => {
  it("adds the months up across both sources", () => {
    const rows = combineSavings({
      ...base,
      months: ["2026-06", "2026-07", "2026-08", "2026-09"],
    });

    expect(sumSavings(rows)).toBe(1_800_000 - 1_100_000 + 2_000_000 + 2_000_000);
  });

  it("says nothing rather than zero when no month had anything to say", () => {
    // The roadmap falls back to the figure the reader typed on a null;
    // a zero here would silently replace it with "you will save nothing".
    const rows = combineSavings({ ...base, months: ["2029-01", "2029-02"] });

    expect(rows.every((r) => r.blank)).toBe(true);
    expect(sumSavings(rows)).toBeNull();
  });

  it("counts the months it does know, ignoring the blanks beside them", () => {
    const rows = combineSavings({ ...base, months: ["2026-01", "2026-06", "2029-01"] });

    expect(sumSavings(rows)).toBe(1_800_000);
  });
});
