import { describe, expect, it } from "vitest";
import { compareAccounts } from "./compare-rows";
import type { AccountGroup } from "@/db/schema";

const account = (id: string, group: AccountGroup, category: string | null = null) => ({
  id,
  name: id,
  group,
  category,
});

const amounts = (entries: Record<string, number>) =>
  Object.entries(entries).map(([accountId, baseAmount]) => ({ accountId, baseAmount }));

const compare = (over: Partial<Parameters<typeof compareAccounts>[0]> = {}) =>
  compareAccounts({
    accounts: [account("식비", "expense"), account("교통비", "expense")],
    previous: amounts({ 식비: 100, 교통비: 50 }),
    current: amounts({ 식비: 120, 교통비: 40 }),
    groupOrder: ["expense"],
    ...over,
  });

describe("compareAccounts", () => {
  it("puts the two periods side by side with their difference", () => {
    const [expenses] = compare();

    expect(expenses.bands[0].rows).toMatchObject([
      { name: "식비", previous: 100, current: 120, change: 20 },
      { name: "교통비", previous: 50, current: 40, change: -10 },
    ]);
    expect(expenses).toMatchObject({ previous: 150, current: 160, change: 10 });
  });

  it("keeps an account that only one period mentions", () => {
    // 「사라진 지출」 and 「처음 생긴 지출」 are the interesting half of a
    // comparison; reading only one period's rows would drop them.
    const [expenses] = compare({
      previous: amounts({ 식비: 100 }),
      current: amounts({ 교통비: 40 }),
    });

    expect(expenses.bands[0].rows).toMatchObject([
      { name: "식비", previous: 100, current: 0, change: -100 },
      { name: "교통비", previous: 0, current: 40, change: 40 },
    ]);
  });

  it("leaves out an account both periods are silent about", () => {
    const [expenses] = compare({
      accounts: [account("식비", "expense"), account("안쓰는것", "expense")],
      previous: amounts({ 식비: 100 }),
      current: amounts({ 식비: 120 }),
    });

    expect(expenses.bands[0].rows.map((r) => r.name)).toEqual(["식비"]);
  });

  it("groups by 상위 그룹, 미분류 last", () => {
    const [expenses] = compare({
      accounts: [
        account("식비", "expense", "먹는 것"),
        account("잡비", "expense"),
        account("카페", "expense", "먹는 것"),
      ],
      previous: amounts({ 식비: 100, 잡비: 10, 카페: 30 }),
      current: amounts({ 식비: 120, 잡비: 5, 카페: 20 }),
    });

    expect(expenses.bands.map((b) => b.category)).toEqual(["먹는 것", null]);
    expect(expenses.bands[0]).toMatchObject({ previous: 130, current: 140, change: 10 });
    expect(expenses.bands[0].rows.map((r) => r.name)).toEqual(["식비", "카페"]);
  });

  it("lists the groups in the book's own order", () => {
    const rows = compareAccounts({
      accounts: [account("은행", "asset"), account("카드", "liability")],
      previous: amounts({ 은행: 1000, 카드: 300 }),
      current: amounts({ 은행: 1200, 카드: 200 }),
      groupOrder: ["liability", "asset"],
    });

    expect(rows.map((g) => g.group)).toEqual(["liability", "asset"]);
  });

  it("drops a group nothing happened in", () => {
    const rows = compareAccounts({
      accounts: [account("은행", "asset"), account("카드", "liability")],
      previous: amounts({ 은행: 1000 }),
      current: amounts({ 은행: 1200 }),
      groupOrder: ["asset", "liability"],
    });

    expect(rows.map((g) => g.group)).toEqual(["asset"]);
  });

  it("has nothing to compare in an empty book", () => {
    expect(compare({ accounts: [], previous: [], current: [] })).toEqual([]);
  });
});
