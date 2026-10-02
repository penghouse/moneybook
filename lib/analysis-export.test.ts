import { describe, expect, it } from "vitest";
import { buildAnalysisExport, type AnalysisExport } from "./analysis-export";
import { buildYearOverview } from "./year-overview";

const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
const map = (e: Record<string, Record<string, number>>) =>
  new Map(Object.entries(e).map(([m, r]) => [m, new Map(Object.entries(r))]));

const overview = (over: Partial<Parameters<typeof buildYearOverview>[0]> = {}) =>
  buildYearOverview({
    accounts: [
      { id: "식비", name: "식비", group: "expense", category: null },
      { id: "급여", name: "급여", group: "income", category: null },
    ],
    months: MONTHS,
    currentMonth: "2026-04",
    firstLedgerMonth: "2026-01",
    actualByMonth: map({
      "2026-01": { 식비: 700_000, 급여: 3_000_000 },
      "2026-02": { 식비: 600_000, 급여: 3_000_000 },
      "2026-03": { 식비: 600_000, 급여: 3_000_000 },
    }),
    budgetByMonth: map(
      Object.fromEntries(MONTHS.map((m) => [m, { 식비: 600_000, 급여: 3_000_000 }])),
    ),
    groupOrder: ["expense", "income"],
    ...over,
  });

const build = (over: Partial<AnalysisExport> = {}) =>
  buildAnalysisExport({
    generatedAt: "2026-04-15",
    currency: "KRW",
    timezone: "Asia/Seoul",
    currentMonth: "2026-04",
    year: "2026",
    overview: overview(),
    money: (m) => `₩${m.toLocaleString("en-US")}`,
    groupLabel: (g) => (g === "expense" ? "비용" : g === "income" ? "수익" : g),
    accounts: [{ name: "식비", group: "expense", category: "먹는 것" }],
    balances: [],
    budgetNotes: [],
    formulas: [],
    transactions: [],
    transactionsFrom: "2025-11-01",
    transactionsTo: "2026-04-15",
    ...over,
  });

describe("buildAnalysisExport", () => {
  it("says where the ledger stops and the plan begins, once", () => {
    // The whole point of the file: a reader must not take a budgeted
    // month for money that was actually spent.
    const text = build();
    expect(text).toContain("2026-01 ~ 2026-03는 실적입니다");
    expect(text).toContain("2026-05 ~ 2026-12는 예산입니다");
    expect(text).toContain("2026-04은 진행 중입니다");
  });

  it("marks the month in progress only where it has outrun its plan", () => {
    // April is read from its budget, so no figure carries a mark. (The
    // reading note's own markdown bold is not one — the assertion has to
    // be about a cell, not about the character.)
    expect(build()).not.toMatch(/₩[\d,]+\*/);

    // …until the ledger passes it, and then the figure is the ledger's.
    const over = build({
      overview: overview({
        actualByMonth: map({ "2026-01": { 식비: 700_000 }, "2026-04": { 식비: 900_000 } }),
      }),
    });
    expect(over).toContain("₩900,000*");
  });

  it("carries the plans and what was written on them", () => {
    const text = build({
      budgetNotes: [
        {
          periodKey: "2026-03",
          account: "식비",
          amount: "₩600,000",
          note: "외식 줄이기로 5만 내림",
        },
      ],
    });
    expect(text).toContain("## 예산에 적어 둔 메모");
    expect(text).toContain("2026-03 식비 ₩600,000 — 외식 줄이기로 5만 내림");
  });

  it("says the entries are only the recent ones", () => {
    const text = build({
      transactions: [
        {
          date: "2026-04-10",
          title: "장보기",
          memo: "주말 손님",
          flow: "식비 ← 신용카드",
          amount: "₩88,000",
        },
      ],
    });
    expect(text).toContain("## 거래 내역 (2025-11-01 ~ 2026-04-15)");
    expect(text).toContain("전부가 아니라 최근 몇 달치입니다");
    expect(text).toContain("2026-04-10 식비 ← 신용카드 ₩88,000 · 장보기 — 주말 손님");
  });

  it("tells a blank apart from a zero", () => {
    const text = build({
      overview: overview({ firstLedgerMonth: "2026-03", budgetByMonth: map({}) }),
    });
    expect(text).toContain("빈 칸은 0이 아니라");
  });

  it("holds the book's own metrics, which say what the reader watches", () => {
    const text = build({
      formulas: [{ scope: "assets", name: "유동성자금 (2026-04-15 기준)", value: "₩12,000,000" }],
    });
    expect(text).toContain("## 계산식");
    expect(text).toContain("유동성자금 (2026-04-15 기준) = ₩12,000,000");
  });

  it("leaves out a section the book has nothing for", () => {
    const text = build();
    expect(text).not.toContain("## 계산식");
    expect(text).not.toContain("## 예산에 적어 둔 메모");
    expect(text).toContain("(이 기간에 거래가 없습니다.)");
  });
});
