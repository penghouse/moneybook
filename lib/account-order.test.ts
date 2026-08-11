import { describe, expect, it } from "vitest";
import type { AccountGroup } from "@/db/schema";
import {
  byGroupOrder,
  categoryBlocks,
  moveAccountWithinCategory,
  moveCategoryBlock,
  renumber,
  type OrderableAccount,
} from "./account-order";

/** "식비:먹는 것" — name doubles as id, and a bare name means 미분류. */
function chart(...spec: string[]): OrderableAccount[] {
  return spec.map((s, i) => {
    const [id, category] = s.split(":");
    return { id, category: category ?? null, sortOrder: i };
  });
}

const names = (accounts: readonly OrderableAccount[] | null) => accounts?.map((a) => a.id) ?? null;

describe("categoryBlocks", () => {
  it("keys blocks on first appearance and pins 미분류 last", () => {
    const blocks = categoryBlocks(chart("식비:먹는 것", "교통비", "카페:먹는 것", "주유:타는 것"));
    expect(blocks.map((b) => [b.category, b.accounts.map((a) => a.id)])).toEqual([
      ["먹는 것", ["식비", "카페"]],
      ["타는 것", ["주유"]],
      [null, ["교통비"]],
    ]);
  });
});

describe("moveAccountWithinCategory", () => {
  // The reported bug: 카페's sortOrder neighbour is 교통비, which is in
  // another category, so the old swap traded their numbers and changed
  // nothing on screen. The move has to see the block, not the number.
  it("moves within the block even when the sortOrder neighbour is another category's", () => {
    const accounts = chart("식비:먹는 것", "교통비", "카페:먹는 것");
    expect(names(moveAccountWithinCategory(accounts, "카페", "up"))).toEqual([
      "카페",
      "식비",
      "교통비",
    ]);
  });

  it("moves down within the block", () => {
    const accounts = chart("식비:먹는 것", "카페:먹는 것", "주유:타는 것");
    expect(names(moveAccountWithinCategory(accounts, "식비", "down"))).toEqual([
      "카페",
      "식비",
      "주유",
    ]);
  });

  it("refuses to move the first account of a block up", () => {
    const accounts = chart("식비:먹는 것", "카페:먹는 것", "주유:타는 것");
    expect(moveAccountWithinCategory(accounts, "식비", "up")).toBeNull();
  });

  it("refuses to move the last account of a block down, even with a block below it", () => {
    const accounts = chart("식비:먹는 것", "카페:먹는 것", "주유:타는 것");
    expect(moveAccountWithinCategory(accounts, "카페", "down")).toBeNull();
  });

  it("refuses both directions for an only child", () => {
    const accounts = chart("식비:먹는 것", "주유:타는 것");
    expect(moveAccountWithinCategory(accounts, "주유", "up")).toBeNull();
    expect(moveAccountWithinCategory(accounts, "주유", "down")).toBeNull();
  });

  it("reorders 미분류 accounts among themselves", () => {
    const accounts = chart("식비:먹는 것", "교통비", "잡비");
    expect(names(moveAccountWithinCategory(accounts, "잡비", "up"))).toEqual([
      "식비",
      "잡비",
      "교통비",
    ]);
  });

  it("returns null for an account that is not in the group", () => {
    expect(moveAccountWithinCategory(chart("식비:먹는 것"), "없는계정", "up")).toBeNull();
  });
});

describe("moveCategoryBlock", () => {
  it("moves a whole block, keeping the accounts inside it together and in order", () => {
    const accounts = chart("식비:먹는 것", "카페:먹는 것", "주유:타는 것", "교통비");
    expect(names(moveCategoryBlock(accounts, "타는 것", "up"))).toEqual([
      "주유",
      "식비",
      "카페",
      "교통비",
    ]);
  });

  it("moves down", () => {
    const accounts = chart("식비:먹는 것", "주유:타는 것");
    expect(names(moveCategoryBlock(accounts, "먹는 것", "down"))).toEqual(["주유", "식비"]);
  });

  it("refuses to move the first block up and the last block down", () => {
    const accounts = chart("식비:먹는 것", "주유:타는 것");
    expect(moveCategoryBlock(accounts, "먹는 것", "up")).toBeNull();
    expect(moveCategoryBlock(accounts, "타는 것", "down")).toBeNull();
  });

  // 미분류 is not a category, so nothing may be pushed under it and it
  // never rises above one.
  it("keeps 미분류 last when the block above it moves down", () => {
    const accounts = chart("식비:먹는 것", "주유:타는 것", "교통비");
    expect(moveCategoryBlock(accounts, "타는 것", "down")).toBeNull();
    expect(names(moveCategoryBlock(accounts, "먹는 것", "down"))).toEqual([
      "주유",
      "식비",
      "교통비",
    ]);
  });

  it("returns null for a category that is not in the group", () => {
    expect(moveCategoryBlock(chart("식비:먹는 것"), "없는그룹", "up")).toBeNull();
  });
});

describe("renumber", () => {
  it("writes only the rows whose number actually changed", () => {
    const accounts = chart("가", "나", "다");
    const moved = moveAccountWithinCategory(accounts, "다", "up")!;
    expect(renumber(moved)).toEqual([
      { id: "다", sortOrder: 1 },
      { id: "나", sortOrder: 2 },
    ]);
  });

  // Interleaved categories get compacted on the first move, which is what
  // stops the next one from swapping across a block boundary again.
  it("makes the blocks contiguous", () => {
    const accounts = chart("식비:먹는 것", "교통비", "카페:먹는 것");
    const moved = moveAccountWithinCategory(accounts, "카페", "up")!;
    expect(names(moved)).toEqual(["카페", "식비", "교통비"]);
    expect(renumber(moved)).toEqual([
      { id: "카페", sortOrder: 0 },
      { id: "식비", sortOrder: 1 },
      { id: "교통비", sortOrder: 2 },
    ]);
  });
});

describe("byGroupOrder", () => {
  const a = (id: string, group: AccountGroup, sortOrder: number) => ({ id, group, sortOrder });

  it("lists 분류 in the book's own order, whatever sortOrder says", () => {
    // sortOrder is assigned section-wide as accounts are created, so on
    // its own it interleaves the 분류 — which is what made the picker
    // read as an unsorted pile.
    const catalog = [
      a("bank", "asset", 0),
      a("food", "expense", 1),
      a("card", "liability", 2),
      a("pay", "income", 3),
    ];
    expect(
      byGroupOrder(catalog, ["asset", "liability", "expense", "income"]).map((x) => x.id),
    ).toEqual(["bank", "card", "food", "pay"]);
  });

  it("follows a reordered book", () => {
    const catalog = [a("bank", "asset", 0), a("card", "liability", 1)];
    expect(byGroupOrder(catalog, ["liability", "asset"]).map((x) => x.id)).toEqual([
      "card",
      "bank",
    ]);
  });

  it("keeps each 분류's own order, which is the one set on /accounts", () => {
    const catalog = [a("b", "expense", 5), a("a", "expense", 2), a("c", "expense", 9)];
    expect(byGroupOrder(catalog, ["expense"]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("puts a 분류 the stored order forgot at the end, not the front", () => {
    const catalog = [a("pay", "income", 0), a("bank", "asset", 1)];
    expect(byGroupOrder(catalog, ["asset"]).map((x) => x.id)).toEqual(["bank", "pay"]);
  });

  it("leaves the input array alone", () => {
    const catalog = [a("food", "expense", 0), a("bank", "asset", 1)];
    byGroupOrder(catalog, ["asset", "expense"]);
    expect(catalog.map((x) => x.id)).toEqual(["food", "bank"]);
  });
});
