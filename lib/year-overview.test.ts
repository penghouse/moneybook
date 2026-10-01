import { describe, expect, it } from "vitest";
import {
  buildYearOverview,
  monthAchievement,
  monthVariance,
  yearAchievements,
  yearVariances,
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

  it("shows the month in progress at what it has already come to, once that passes the plan", () => {
    // 740,000 spent against a 600,000 plan with the month still running.
    // The plan is not a forecast any more — the book can show it spent.
    const [, expense] = build({
      actualByMonth: byMonth({
        "2026-01": { 식비: 700_000 },
        "2026-03": { 식비: 740_000 },
      }),
    }).sections;

    expect(expense.cells[2]).toMatchObject({
      amount: 740_000,
      plan: 600_000,
      source: "actual",
      settled: false,
    });
  });

  it("still reads a half-finished month from its plan while it is under it", () => {
    const [, expense] = build({
      actualByMonth: byMonth({ "2026-03": { 식비: 200_000 } }),
    }).sections;

    expect(expense.cells[2]).toMatchObject({ amount: 600_000, source: "budget" });
  });

  it("shows an unbudgeted item the month has already spent on", () => {
    // Nothing to exceed, but a figure the book holds and the screen was
    // leaving blank.
    // 수입 drops out entirely here — nothing budgeted and nothing
    // earned — so 비용 is the only section left.
    const [expense] = build({
      budgetByMonth: byMonth({}),
      actualByMonth: byMonth({ "2026-03": { 식비: 40_000 } }),
    }).sections;

    expect(expense.cells[2]).toMatchObject({ amount: 40_000, plan: null, blank: false });
  });

  it("leaves the months ahead alone — nothing can be over before it happens", () => {
    const [, expense] = build({
      actualByMonth: byMonth({ "2026-03": { 식비: 900_000 }, "2026-04": { 식비: 900_000 } }),
    }).sections;

    expect(expense.cells[3]).toMatchObject({ amount: 600_000, source: "budget" });
  });

  it("counts a total as the plan only while every part of it is", () => {
    const { sections } = build({
      accounts: [acc("식비", "expense"), acc("교통비", "expense")],
      budgetByMonth: byMonth(
        Object.fromEntries(MONTHS.map((m) => [m, { 식비: 600_000, 교통비: 100_000 }])),
      ),
      actualByMonth: byMonth({ "2026-03": { 식비: 740_000 } }),
      groupOrder: ["expense"],
    });

    // 740,000 read from the ledger plus 100,000 still read from its plan.
    expect(sections[0].cells[2]).toMatchObject({ amount: 840_000, source: "actual" });
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

  it("says nothing about a month that is not over yet", () => {
    // The figure and the plan are the same number there, so the answer
    // would be 100% every time — the screen agreeing with itself.
    const [, expense] = build().sections;

    expect(monthAchievement(expense.cells[2])).toBeNull();
    expect(monthAchievement(expense.cells[11])).toBeNull();
  });

  it("says nothing about the month in progress even once it is over its plan", () => {
    // The cell now reads from the ledger, but the month has not finished
    // spending. 「140%」 against a whole month's plan on the 20th would
    // read as a verdict on a month that is still going.
    const [, expense] = build({
      actualByMonth: byMonth({ "2026-03": { 식비: 840_000 } }),
    }).sections;

    expect(expense.cells[2].source).toBe("actual");
    expect(monthAchievement(expense.cells[2])).toBeNull();
  });

  it("says nothing where there was no plan to fall short of", () => {
    const [, expense] = build({ budgetByMonth: byMonth({}) }).sections;
    expect(monthAchievement(expense.cells[0])).toBeNull();
  });
});

describe("yearAchievements", () => {
  it("runs up through the year, ending on what the year is on course for", () => {
    const [, expense] = build().sections;
    const progress = yearAchievements(expense);

    // 700 of a 7,200 year by the end of January.
    expect(progress[0].rate).toBeCloseTo(700 / 7_200, 10);
    expect(progress[1].rate).toBeCloseTo(1_200 / 7_200, 10);
    // The blended year lands where the plan does: January's overspend
    // and February's saving cancel out.
    expect(progress[11].rate).toBeCloseTo(1, 10);
  });

  it("paces by the plan's own shape, not by months elapsed", () => {
    // Nothing budgeted until July, so being on plan means still at zero
    // at the end of June rather than half way through the year.
    const late = Object.fromEntries(MONTHS.slice(6).map((m) => [m, { 식비: 600_000 }]));
    const [expense] = build({
      accounts: [acc("식비", "expense")],
      actualByMonth: byMonth({}),
      budgetByMonth: byMonth(late),
      groupOrder: ["expense"],
    }).sections;

    const progress = yearAchievements(expense);
    expect(progress[5].pace).toBe(0);
    expect(progress[6].pace).toBeCloseTo(1 / 6, 10);
    expect(progress[11].pace).toBeCloseTo(1, 10);
  });

  it("leaves what had no plan out of both sides", () => {
    // 식비 spent exactly its plan; 교통비 was never budgeted. Counting
    // 교통비 in the numerator alone read as 133% with nothing over.
    const onPlan = Object.fromEntries(MONTHS.map((m) => [m, { 식비: 600_000, 교통비: 200_000 }]));
    const [expense] = build({
      accounts: [acc("식비", "expense"), acc("교통비", "expense")],
      currentMonth: "2027-01",
      actualByMonth: byMonth(onPlan),
      budgetByMonth: byMonth(Object.fromEntries(MONTHS.map((m) => [m, { 식비: 600_000 }]))),
      groupOrder: ["expense"],
    }).sections;

    // The 합계 column still says what actually went out.
    expect(expense.total).toBe(9_600_000);
    expect(expense.plan).toBe(7_200_000);
    expect(yearAchievements(expense)[11].rate).toBeCloseTo(1, 10);
    // And the month-by-month reading agrees.
    expect(monthAchievement(expense.cells[0])).toBeCloseTo(1, 10);
  });

  it("leaves a month that had no plan out too", () => {
    // Budgeted for six months, spent to plan all twelve. The six
    // unbudgeted months are real spending with nothing to be held to.
    const [expense] = build({
      accounts: [acc("식비", "expense")],
      currentMonth: "2027-01",
      actualByMonth: byMonth(Object.fromEntries(MONTHS.map((m) => [m, { 식비: 600_000 }]))),
      budgetByMonth: byMonth(
        Object.fromEntries(MONTHS.slice(0, 6).map((m) => [m, { 식비: 600_000 }])),
      ),
      groupOrder: ["expense"],
    }).sections;

    expect(expense.total).toBe(7_200_000);
    expect(yearAchievements(expense)[11].rate).toBeCloseTo(1, 10);
  });

  it("says nothing against a year nobody planned", () => {
    const [, expense] = build({ budgetByMonth: byMonth({}) }).sections;
    expect(yearAchievements(expense).every((p) => p.rate === null)).toBe(true);
  });
});

describe("monthVariance", () => {
  /** A finished year of one month's figures, repeated. */
  const saving = (actual: Record<string, number>, budget: Record<string, number>) =>
    buildYearOverview({
      accounts: [acc("급여", "income"), acc("식비", "expense")],
      months: MONTHS,
      currentMonth: "2027-01",
      firstLedgerMonth: "2026-01",
      actualByMonth: byMonth(Object.fromEntries(MONTHS.map((m) => [m, actual]))),
      budgetByMonth: byMonth(Object.fromEntries(MONTHS.map((m) => [m, budget]))),
      groupOrder: ["income", "expense"],
    }).saving;

  it("says how far off the plan the month landed", () => {
    const line = saving({ 급여: 3_400_000, 식비: 700_000 }, { 급여: 3_400_000, 식비: 600_000 });
    // 100,000 over on the spending side is 100,000 less saved.
    expect(monthVariance(line.cells[0])).toBe(-100_000);
  });

  it("keeps its verdict when the plan itself is a loss", () => {
    // Planned to lose 500,000 and lost 100,000. A ratio called this 20%
    // and painted it red; it is 400,000 better than planned.
    const line = saving({ 급여: 500_000, 식비: 600_000 }, { 급여: 500_000, 식비: 1_000_000 });
    expect(line.cells[0]).toMatchObject({ amount: -100_000, plan: -500_000 });
    expect(monthVariance(line.cells[0])).toBe(400_000);

    // And the other way: 400,000 worse, which a ratio called 180%.
    const worse = saving({ 급여: 500_000, 식비: 1_400_000 }, { 급여: 500_000, 식비: 1_000_000 });
    expect(monthVariance(worse.cells[0])).toBe(-400_000);
  });

  it("has an answer for a break-even plan, which a ratio does not", () => {
    const line = saving({ 급여: 700_000, 식비: 600_000 }, { 급여: 600_000, 식비: 600_000 });
    expect(line.cells[0].plan).toBe(0);
    expect(monthAchievement(line.cells[0])).toBeNull();
    expect(monthVariance(line.cells[0])).toBe(100_000);
  });

  it("counts only the side that was budgeted, and says so in won", () => {
    // 수입만 예산: the income was exactly on plan and the spending had
    // no plan to miss, so nothing is off. A ratio reported 100% — the
    // same answer, but reading as though the month's spending had been
    // weighed and passed.
    const incomeOnly = saving({ 급여: 3_400_000, 식비: 700_000 }, { 급여: 3_400_000 });
    expect(monthVariance(incomeOnly.cells[0])).toBe(0);

    // 지출만 예산: 100,000 over, and that is the whole of the deviation.
    const expenseOnly = saving({ 급여: 3_400_000, 식비: 700_000 }, { 식비: 600_000 });
    expect(monthVariance(expenseOnly.cells[0])).toBe(-100_000);
  });

  it("says nothing about a month that is not over", () => {
    const line = buildYearOverview({
      accounts: [acc("급여", "income"), acc("식비", "expense")],
      months: MONTHS,
      currentMonth: "2026-03",
      firstLedgerMonth: "2026-01",
      actualByMonth: byMonth({}),
      budgetByMonth: byMonth(
        Object.fromEntries(MONTHS.map((m) => [m, { 급여: 3_000_000, 식비: 600_000 }])),
      ),
      groupOrder: ["income", "expense"],
    }).saving;

    expect(monthVariance(line.cells[2])).toBeNull();
  });
});

describe("yearVariances", () => {
  it("runs the difference up from January", () => {
    const line = buildYearOverview({
      accounts: [acc("급여", "income"), acc("식비", "expense")],
      months: MONTHS,
      currentMonth: "2027-01",
      firstLedgerMonth: "2026-01",
      actualByMonth: byMonth({
        "2026-01": { 급여: 3_400_000, 식비: 700_000 },
        "2026-02": { 급여: 3_400_000, 식비: 550_000 },
      }),
      budgetByMonth: byMonth(
        Object.fromEntries(MONTHS.map((m) => [m, { 급여: 3_400_000, 식비: 600_000 }])),
      ),
      groupOrder: ["income", "expense"],
    }).saving;

    const running = yearVariances(line);
    expect(running[0]).toBe(-100_000);
    // February saved 50,000 more than planned, so the year is 50,000 behind.
    expect(running[1]).toBe(-50_000);
    // The other ten months earned and spent nothing against a plan to
    // save 2,800,000 each.
    expect(running[2]).toBe(-50_000 - 2_800_000);
  });

  it("says nothing against a year nobody planned", () => {
    const line = buildYearOverview({
      accounts: [acc("식비", "expense")],
      months: MONTHS,
      currentMonth: "2027-01",
      firstLedgerMonth: "2026-01",
      actualByMonth: byMonth({ "2026-01": { 식비: 700_000 } }),
      budgetByMonth: byMonth({}),
      groupOrder: ["expense"],
    }).saving;

    expect(yearVariances(line).every((v) => v === null)).toBe(true);
  });
});
