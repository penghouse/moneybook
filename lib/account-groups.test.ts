import { describe, expect, it } from "vitest";
import { ACCOUNT_GROUPS } from "@/db/schema";
import { byGroupOrder, moveGroup, parseGroupOrder, serializeGroupOrder } from "./account-groups";

describe("parseGroupOrder", () => {
  it("keeps a well-formed order as given", () => {
    expect(parseGroupOrder("expense,income,asset,liability,equity")).toEqual([
      "expense",
      "income",
      "asset",
      "liability",
      "equity",
    ]);
  });

  it("always returns all five groups, whatever was stored", () => {
    // The failure this guards against is a group silently disappearing
    // from the accounts page together with everything filed under it.
    for (const stored of ["", "asset", "nonsense", "asset,asset,asset", null, undefined]) {
      const parsed = parseGroupOrder(stored);
      expect(parsed).toHaveLength(ACCOUNT_GROUPS.length);
      expect([...parsed].sort()).toEqual([...ACCOUNT_GROUPS].sort());
    }
  });

  it("puts the groups it was told about first, and the rest behind them", () => {
    expect(parseGroupOrder("income,expense")).toEqual([
      "income",
      "expense",
      "asset",
      "liability",
      "equity",
    ]);
  });

  it("drops names that are not groups, and duplicates", () => {
    expect(parseGroupOrder("expense,drink,expense,asset")).toEqual([
      "expense",
      "asset",
      "liability",
      "equity",
      "income",
    ]);
  });

  it("round-trips through serialize", () => {
    const order = parseGroupOrder("liability,expense,asset,income,equity");
    expect(parseGroupOrder(serializeGroupOrder(order))).toEqual(order);
  });
});

describe("moveGroup", () => {
  const order = [...ACCOUNT_GROUPS];

  it("swaps with the neighbour in the given direction", () => {
    expect(moveGroup(order, "liability", "up")).toEqual([
      "liability",
      "asset",
      "equity",
      "expense",
      "income",
    ]);
    expect(moveGroup(order, "asset", "down")).toEqual([
      "liability",
      "asset",
      "equity",
      "expense",
      "income",
    ]);
  });

  it("is a no-op at either end", () => {
    expect(moveGroup(order, "asset", "up")).toEqual(order);
    expect(moveGroup(order, "income", "down")).toEqual(order);
  });
});

describe("byGroupOrder", () => {
  it("sorts by the book's order rather than the canonical one", () => {
    const order = parseGroupOrder("income,expense,asset,liability,equity");
    const rows = [
      { group: "asset" as const },
      { group: "income" as const },
      { group: "expense" as const },
    ];
    const sorted = [...rows].sort((a, b) => byGroupOrder(order)(a.group, b.group));
    expect(sorted.map((r) => r.group)).toEqual(["income", "expense", "asset"]);
  });
});
