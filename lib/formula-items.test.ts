import { describe, expect, it } from "vitest";
import { buildFormulaItems, formulaValues, type FormulaSourceAccount } from "./formula-items";

const labels = {
  totals: {
    assets: "총 자산",
    liabilities: "총 부채",
    netWorth: "총 순자산",
    income: "수익 합계",
    expense: "비용 합계",
    netIncome: "순이익",
  },
};

const catalog: FormulaSourceAccount[] = [
  { id: "bank", name: "은행", group: "asset", category: "유동성자금" },
  { id: "cash", name: "현금", group: "asset", category: "유동성자금" },
  { id: "stock", name: "주식", group: "asset", category: "투자" },
  { id: "car", name: "자동차", group: "asset", category: null },
  { id: "card", name: "신용카드", group: "liability", category: null },
];

const amounts = new Map([
  ["bank", 400_000],
  ["cash", 100_000],
  ["stock", 300_000],
  ["car", 200_000],
  ["card", 150_000],
]);

const build = (groupOrder: ("asset" | "liability")[] = ["asset", "liability"]) =>
  buildFormulaItems({
    scope: "assets",
    groupOrder,
    accounts: catalog,
    amountByAccountId: amounts,
    labels,
  });

describe("buildFormulaItems", () => {
  it("lays the menu out the way the report reads: group, its 상위 그룹, its accounts", () => {
    expect(build().map((i) => `${i.level}:${i.label}`)).toEqual([
      "total:총 자산",
      "category:유동성자금",
      "account:은행",
      "account:현금",
      "category:투자",
      "account:주식",
      "account:자동차",
      "total:총 부채",
      "account:신용카드",
      "total:총 순자산",
    ]);
  });

  it("follows the book's group order", () => {
    const labelsInOrder = build(["liability", "asset"]).map((i) => i.label);
    expect(labelsInOrder.indexOf("총 부채")).toBeLessThan(labelsInOrder.indexOf("총 자산"));
    // The derived total is last either way — it is about both groups.
    expect(labelsInOrder.at(-1)).toBe("총 순자산");
  });

  // An item missing from this menu is a term nobody can pick, so a
  // group order that lost one still gets it.
  it("adds a group the book's order forgot", () => {
    expect(build(["asset"]).map((i) => i.label)).toContain("총 부채");
  });

  it("sums a category from its own accounts and a group from all of them", () => {
    const byLabel = new Map(build().map((i) => [i.label, i.amount]));
    expect(byLabel.get("유동성자금")).toBe(500_000);
    expect(byLabel.get("투자")).toBe(300_000);
    expect(byLabel.get("총 자산")).toBe(1_000_000);
    expect(byLabel.get("총 부채")).toBe(150_000);
    expect(byLabel.get("총 순자산")).toBe(850_000);
  });

  it("treats an account the report has no figure for as zero", () => {
    const items = buildFormulaItems({
      scope: "assets",
      groupOrder: ["asset", "liability"],
      accounts: catalog,
      amountByAccountId: new Map([["bank", 400_000]]),
      labels,
    });
    const byLabel = new Map(items.map((i) => [i.label, i.amount]));
    expect(byLabel.get("현금")).toBe(0);
    expect(byLabel.get("총 자산")).toBe(400_000);
  });

  it("keys each row so a formula's terms can find it again", () => {
    const keys = build().map((i) => i.key);
    expect(keys).toContain("total:assets");
    expect(keys).toContain("category:asset:유동성자금");
    expect(keys).toContain("account:bank");
    expect(keys).toContain("total:netWorth");
  });

  it("builds the income statement's menu from its own totals", () => {
    const items = buildFormulaItems({
      scope: "income",
      groupOrder: ["income", "expense"],
      accounts: [
        { id: "pay", name: "급여", group: "income", category: null },
        { id: "food", name: "식비", group: "expense", category: "먹는 것" },
      ],
      amountByAccountId: new Map([
        ["pay", 3_000_000],
        ["food", 500_000],
      ]),
      labels,
    });
    expect(items.map((i) => i.label)).toEqual([
      "수익 합계",
      "급여",
      "비용 합계",
      "먹는 것",
      "식비",
      "순이익",
    ]);
    expect(items.at(-1)!.amount).toBe(2_500_000);
  });
});

describe("formulaValues", () => {
  it("is the menu keyed by term", () => {
    expect(formulaValues(build()).get("category:asset:유동성자금")).toBe(500_000);
  });
});
