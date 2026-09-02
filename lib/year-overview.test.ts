import { describe, expect, it } from "vitest";
import {
  buildYearOverview,
  monthAchievement,
  yearAchievements,
  type YearAccount,
} from "./year-overview";

const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

const acc = (
  id: string,
  group: "income" | "expense",
  category: string | null = null,
): YearAccount => ({
  id,
  name: id,
  group,
  category,
});

/** month -> accountId -> amount, written the way the tests read. */
const byMonth = (entries: Record<string, Record<string, number>>) =>
  new Map(Object.entries(entries).map(([month, row]) => [month, new Map(Object.entries(row))]));

const build = (over: Partial<Parameters<typeof buildYearOverview>[0]> = {}) =>
  buildYearOverview({
    accounts: [acc("급여", "income"), acc("식비", "expense")],
    months: MONTHS,
    currentMonth: "2026-03",
    firstLedgerMonth: "2026-01",
    actualByMonth: byMonth({
      "2026-01": { 급여: 3_000_000, 식비: 700_000 },
      "2026-02": { 급여: 3_000_000, 식비: 500_000 },
    }),
    budgetByMonth: byMonth(
      Object.fromEntries(MONTHS.map((m) => [m, { 급여: 3_000_000, 식비: 600_000 }])),
    ),
    groupOrder: ["income", "expense"],
    ...over,
  });

describe("buildYearOverview", () => {
  it("reads the ledger behind and the budget ahead, month by month", () => {
    const [income, expense] = build().sections;

    expect(expense.cells.map((c) => c.source)).toEqual([
      "actual",
      "actual",
      ...Array(10).fill("budget"),
    ]);
    // January overspent, February came in under, and March onwards is
    // simply the plan — the month in progress included.
    expect(expense.cells.map((c) => c.amount).slice(0, 4)).toEqual([
      700_000, 500_000, 600_000, 600_000,
    ]);
    expect(income.total).toBe(36_000_000);
  });

  it("keeps the plan for months that have already happened", () => {
    // Without this there is no 달성률 at all: the figure a past month is
    // measured against is exactly the one a blended reading throws away.
    const [, expense] = build().sections;

    expect(expense.cells[0]).toMatchObject({ amount: 700_000, plan: 600_000, source: "actual" });
    expect(expense.plan).toBe(7_200_000);
    expect(expense.total).toBe(7_200_000 + 100_000 - 100_000);
  });

  it("does not read a month it is in the middle of", () => {
    // March has 200,000 posted so far. Showing that would read as a
    // remarkably cheap month rather than an unfinished one.
    const [, expense] = build({
      currentMonth: "2026-03",
      actualByMonth: byMonth({
        "2026-01": { 식비: 700_000 },
        "2026-03": { 식비: 200_000 },
      }),
    }).sections;

    expect(expense.cells[2]).toMatchObject({ amount: 600_000, source: "budget" });
  });

  it("tells a month outside the book from a month that spent nothing", () => {
    const [, expense] = build({ firstLedgerMonth: "2026-02" }).sections;

    expect(expense.cells[0]).toMatchObject({ amount: 0, blank: true });
    expect(expense.cells[1]).toMatchObject({ amount: 500_000, blank: false });
  });

  it("has no plan where none was set, rather than a plan of zero", () => {
    const [, expense] = build({ budgetByMonth: byMonth({}) }).sections;

    expect(expense.cells.every((c) => c.plan === null)).toBe(true);
    // And a month ahead with no budget is a gap, not a plan to spend 0.
    expect(expense.cells[11]).toMatchObject({ amount: 0, blank: true });
  });

  it("groups by 상위 그룹, 미분류 last, and totals each band", () => {
    const { sections } = build({
      accounts: [
        acc("식비", "expense", "먹는 것"),
        acc("잡비", "expense"),
        acc("카페", "expense", "먹는 것"),
      ],
      actualByMonth: byMonth({ "2026-01": { 식비: 700_000, 카페: 50_000, 잡비: 10_000 } }),
      budgetByMonth: byMonth({}),
      groupOrder: ["expense"],
    });

    expect(sections[0].bands.map((b) => b.category)).toEqual(["먹는 것", null]);
    expect(sections[0].bands[0].cells[0].amount).toBe(750_000);
    expect(sections[0].cells[0].amount).toBe(760_000);
  });

  it("leaves out an account the whole year is silent about", () => {
    const { sections } = build({
      accounts: [acc("식비", "expense"), acc("안쓰는것", "expense")],
      budgetByMonth: byMonth({}),
      groupOrder: ["expense"],
    });

    expect(sections[0].bands[0].rows.map((r) => r.name)).toEqual(["식비"]);
  });

  it("works 저축가능액 out as 수입 − 지출, and runs it up from January", () => {
    const { saving, cumulativeSaving } = build();

    expect(saving.cells[0].amount).toBe(2_300_000);
    expect(saving.cells[1].amount).toBe(2_500_000);
    expect(saving.cells[2].amount).toBe(2_400_000);
    expect(cumulativeSaving.slice(0, 3)).toEqual([2_300_000, 4_800_000, 7_200_000]);
    expect(cumulativeSaving[11]).toBe(saving.total);
  });

  it("ignores 자산·부채 — a year of flows is not a balance sheet", () => {
    const { sections } = buildYearOverview({
      accounts: [acc("식비", "expense")],
      months: MONTHS,
      currentMonth: "2026-03",
      firstLedgerMonth: "2026-01",
      actualByMonth: byMonth({ "2026-01": { 식비: 700_000 } }),
      budgetByMonth: byMonth({}),
      groupOrder: ["asset", "liability", "expense"],
    });

    expect(sections.map((s) => s.group)).toEqual(["expense"]);
  });

  it("has nothing to show for an empty book", () => {
    const { sections, saving } = build({
      accounts: [],
      actualByMonth: byMonth({}),
      budgetByMonth: byMonth({}),
    });

    expect(sections).toEqual([]);
    expect(saving.cells.every((c) => c.amount === 0 && c.blank)).toBe(true);
  });
});

describe("monthAchievement", () => {
  it("says what a finished month came to against its plan", () => {
    const [, expense] = build().sections;

    expect(monthAchievement(expense.cells[0])).toBeCloseTo(700 / 600, 10);
    expect(monthAchievement(expense.cells[1])).toBeCloseTo(500 / 600, 10);
  });

  it("says nothing about a month still running on its budget", () => {
    // The figure and the plan are the same number there, so the answer
    // would be 100% every time — the screen agreeing with itself.
    const [, expense] = build().sections;

    expect(monthAchievement(expense.cells[2])).toBeNull();
    expect(monthAchievement(expense.cells[11])).toBeNull();
  });

  it("says nothing where there was no plan to fall short of", () => {
    const [, expense] = build({ budgetByMonth: byMonth({}) }).sections;
    expect(monthAchievement(expense.cells[0])).toBeNull();
  });
});

describe("yearAchievements", () => {
  it("runs up through the year, ending on what the year is on course for", () => {
    const [, expense] = build().sections;
    const rates = yearAchievements(expense);

    // 700 of a 7,200 year by the end of January.
    expect(rates[0]).toBeCloseTo(700 / 7_200, 10);
    expect(rates[1]).toBeCloseTo(1_200 / 7_200, 10);
    // The blended year lands where the plan does: January's overspend
    // and February's saving cancel out.
    expect(rates[11]).toBeCloseTo(1, 10);
  });

  it("says nothing against a year nobody planned", () => {
    const [, expense] = build({ budgetByMonth: byMonth({}) }).sections;
    expect(yearAchievements(expense).every((r) => r === null)).toBe(true);
  });
});
