import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/test-client";
import {
  accounts,
  authUsers,
  exchangeRates,
  sections,
  transactionLines,
  transactions,
  type AccountGroup,
  type LineSide,
  type TransactionKind,
} from "@/db/schema";
import type { Db } from "@/db/types";
import {
  assertBalanced,
  getAccountBalances,
  getAccountFlows,
  getTitleTotals,
  getMonthlyBalanceSheet,
  getTitleSuggestions,
  getPeriodTotals,
  getRunningBalances,
  getUnrealizedFx,
  UnbalancedTransactionError,
  type BalanceLineInput,
} from "./ledger";
import { convertMinorUnits } from "./money";

const BASE_CURRENCY = "KRW";
const SECTION_ID = "sec1";

async function seedSection(db: Db) {
  await db.insert(authUsers).values({ id: "u1", email: "me@example.com" });
  await db.insert(sections).values({
    id: SECTION_ID,
    userId: "u1",
    name: "기본",
    baseCurrency: BASE_CURRENCY,
    timezone: "Asia/Seoul",
    startDate: "2026-01-01",
  });

  const chart: { key: string; group: AccountGroup; name: string; currency: string }[] = [
    { key: "bank", group: "asset", name: "국민은행", currency: "KRW" },
    { key: "receivable", group: "asset", name: "받을돈", currency: "KRW" },
    { key: "usd", group: "asset", name: "달러예금", currency: "USD" },
    { key: "card", group: "liability", name: "신용카드", currency: "KRW" },
    { key: "opening", group: "equity", name: "기초자본", currency: "KRW" },
    { key: "food", group: "expense", name: "식비", currency: "KRW" },
    { key: "supplies", group: "expense", name: "생활용품", currency: "KRW" },
    { key: "tax", group: "expense", name: "세금", currency: "KRW" },
    { key: "insurance", group: "expense", name: "건강보험료", currency: "KRW" },
    { key: "fxLoss", group: "expense", name: "외화환산손실", currency: "KRW" },
    { key: "salary", group: "income", name: "급여", currency: "KRW" },
    { key: "fxGain", group: "income", name: "외화환산이익", currency: "KRW" },
  ];

  const ids: Record<string, string> = {};
  for (const c of chart) {
    const id = `acc_${c.key}`;
    ids[c.key] = id;
    await db.insert(accounts).values({
      id,
      sectionId: SECTION_ID,
      group: c.group,
      name: c.name,
      currency: c.currency,
    });
  }
  return ids;
}

type TestLine = BalanceLineInput & { accountId: string };

/** Mirrors what a step-5 server action will do: validate, then write. */
async function postTransaction(
  db: Db,
  params: {
    date: string;
    title: string;
    kind?: TransactionKind;
    lines: TestLine[];
  },
) {
  const kind = params.kind ?? "normal";
  assertBalanced(params.lines, BASE_CURRENCY, kind);

  const [tx] = await db
    .insert(transactions)
    .values({ sectionId: SECTION_ID, date: params.date, title: params.title, kind })
    .returning();

  for (const [i, line] of params.lines.entries()) {
    await db.insert(transactionLines).values({
      transactionId: tx.id,
      lineOrder: i,
      side: line.side,
      accountId: line.accountId,
      currency: line.currency,
      amount: line.amount,
      rate: line.rate,
      baseAmount: line.baseAmount,
    });
  }
  return tx.id;
}

function line(
  side: LineSide,
  accountId: string,
  currency: string,
  amount: number,
  rate: number | null,
): TestLine {
  const baseAmount = rate === null ? 0 : convertMinorUnits(amount, rate, currency, BASE_CURRENCY);
  return { side, accountId, currency, amount, rate, baseAmount };
}

describe("assertBalanced", () => {
  it("accepts a simple two-line transaction", () => {
    expect(() =>
      assertBalanced(
        [line("left", "food", "KRW", 12_000, 1), line("right", "card", "KRW", 12_000, 1)],
        BASE_CURRENCY,
      ),
    ).not.toThrow();
  });

  it("rejects a single-line transaction", () => {
    expect(() => assertBalanced([line("left", "food", "KRW", 1000, 1)], BASE_CURRENCY)).toThrow(
      UnbalancedTransactionError,
    );
  });

  it("rejects lines that are all on one side", () => {
    expect(() =>
      assertBalanced(
        [line("left", "food", "KRW", 1000, 1), line("left", "supplies", "KRW", 1000, 1)],
        BASE_CURRENCY,
      ),
    ).toThrow(UnbalancedTransactionError);
  });

  it("rejects a transaction where left and right totals differ", () => {
    expect(() =>
      assertBalanced(
        [line("left", "food", "KRW", 12_000, 1), line("right", "card", "KRW", 11_000, 1)],
        BASE_CURRENCY,
      ),
    ).toThrow(UnbalancedTransactionError);
  });

  it("rejects a negative amount", () => {
    const bad = line("left", "food", "KRW", 12_000, 1);
    expect(() =>
      assertBalanced(
        [{ ...bad, amount: -1, baseAmount: -1 }, line("right", "card", "KRW", 12_000, 1)],
        BASE_CURRENCY,
      ),
    ).toThrow(UnbalancedTransactionError);
  });

  it("rejects a mismatched amount*rate vs baseAmount", () => {
    const bad = line("left", "food", "KRW", 12_000, 1);
    expect(() =>
      assertBalanced(
        [{ ...bad, baseAmount: 5_000 }, line("right", "card", "KRW", 12_000, 1)],
        BASE_CURRENCY,
      ),
    ).toThrow(UnbalancedTransactionError);
  });

  it("accepts a split transaction (3 lines)", () => {
    expect(() =>
      assertBalanced(
        [
          line("left", "food", "KRW", 30_000, 1),
          line("left", "supplies", "KRW", 15_000, 1),
          line("right", "card", "KRW", 45_000, 1),
        ],
        BASE_CURRENCY,
      ),
    ).not.toThrow();
  });

  it("accepts a salary transaction (4 lines, gross vs net)", () => {
    expect(() =>
      assertBalanced(
        [
          line("left", "bank", "KRW", 3_200_000, 1),
          line("left", "tax", "KRW", 400_000, 1),
          line("left", "insurance", "KRW", 300_000, 1),
          line("right", "salary", "KRW", 3_900_000, 1),
        ],
        BASE_CURRENCY,
      ),
    ).not.toThrow();
  });

  it("accepts a cross-currency exchange", () => {
    expect(() =>
      assertBalanced(
        [
          line("left", "usd", "USD", 100_000 /* $1,000.00 */, 1300),
          line("right", "bank", "KRW", 1_300_000, 1),
        ],
        BASE_CURRENCY,
      ),
    ).not.toThrow();
  });

  describe("revaluation", () => {
    it("accepts amount=0/rate=null on the foreign leg, normal validation on the base-currency leg", () => {
      expect(() =>
        assertBalanced(
          [
            {
              side: "left",
              accountId: "usd",
              currency: "USD",
              amount: 0,
              rate: null,
              baseAmount: 80_000,
            },
            line("right", "fxGain", "KRW", 80_000, 1),
          ],
          BASE_CURRENCY,
          "revaluation",
        ),
      ).not.toThrow();
    });

    it("rejects a revaluation leg that still carries a foreign-currency amount", () => {
      expect(() =>
        assertBalanced(
          [
            line("left", "usd", "USD", 100, 1300), // should be amount=0, rate=null
            line("right", "fxGain", "KRW", 130_000, 1),
          ],
          BASE_CURRENCY,
          "revaluation",
        ),
      ).toThrow(UnbalancedTransactionError);
    });
  });
});

describe("getAccountBalances / getAccountFlows", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  it("reflects a simple transaction with correct normal-balance signs", async () => {
    await postTransaction(db, {
      date: "2026-07-31",
      title: "점심",
      lines: [line("left", ids.food, "KRW", 12_000, 1), line("right", ids.card, "KRW", 12_000, 1)],
    });

    const balances = await getAccountBalances(db, {
      sectionId: SECTION_ID,
      asOf: "2026-07-31",
    });
    const byId = Object.fromEntries(balances.map((b) => [b.accountId, b]));

    expect(byId[ids.food].baseAmount).toBe(12_000); // expense: debit-normal, positive
    expect(byId[ids.card].baseAmount).toBe(12_000); // liability: credit-normal, flipped to positive
  });

  it("keeps the foreign-currency amount unchanged through a revaluation", async () => {
    await postTransaction(db, {
      date: "2026-07-20",
      title: "환전",
      lines: [
        line("left", ids.usd, "USD", 100_000, 1300),
        line("right", ids.bank, "KRW", 1_300_000, 1),
      ],
    });

    await postTransaction(db, {
      date: "2026-07-31",
      title: "환율 반영",
      kind: "revaluation",
      lines: [
        {
          side: "left",
          accountId: ids.usd,
          currency: "USD",
          amount: 0,
          rate: null,
          baseAmount: 80_000,
        },
        line("right", ids.fxGain, "KRW", 80_000, 1),
      ],
    });

    const balances = await getAccountBalances(db, {
      sectionId: SECTION_ID,
      asOf: "2026-07-31",
    });
    const byId = Object.fromEntries(balances.map((b) => [b.accountId, b]));

    expect(byId[ids.usd].amount).toBe(100_000); // $1,000.00 unchanged
    expect(byId[ids.usd].baseAmount).toBe(1_380_000); // ₩1,300,000 + ₩80,000
    expect(byId[ids.fxGain].baseAmount).toBe(80_000);
  });

  it("getAccountFlows only counts activity within the date range", async () => {
    await postTransaction(db, {
      date: "2026-06-15",
      title: "이전 달 식비",
      lines: [line("left", ids.food, "KRW", 5_000, 1), line("right", ids.card, "KRW", 5_000, 1)],
    });
    await postTransaction(db, {
      date: "2026-07-10",
      title: "이번 달 식비",
      lines: [line("left", ids.food, "KRW", 8_000, 1), line("right", ids.card, "KRW", 8_000, 1)],
    });

    const july = await getAccountFlows(db, {
      sectionId: SECTION_ID,
      from: "2026-07-01",
      to: "2026-07-31",
    });
    const food = july.find((b) => b.accountId === ids.food);
    expect(food?.baseAmount).toBe(8_000);
  });
});

describe("getPeriodTotals", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  it("aggregates income/expense per month and zero-fills months with no activity", async () => {
    await postTransaction(db, {
      date: "2026-06-15",
      title: "6월 급여",
      lines: [
        line("left", ids.bank, "KRW", 3_000_000, 1),
        line("right", ids.salary, "KRW", 3_000_000, 1),
      ],
    });
    await postTransaction(db, {
      date: "2026-07-05",
      title: "7월 식비",
      lines: [line("left", ids.food, "KRW", 20_000, 1), line("right", ids.card, "KRW", 20_000, 1)],
    });
    await postTransaction(db, {
      date: "2026-07-20",
      title: "7월 급여",
      lines: [
        line("left", ids.bank, "KRW", 3_100_000, 1),
        line("right", ids.salary, "KRW", 3_100_000, 1),
      ],
    });

    const totals = await getPeriodTotals(db, {
      sectionId: SECTION_ID,
      periods: ["2026-06", "2026-07", "2026-08"],
    });

    expect(totals).toEqual([
      { period: "2026-06", income: 3_000_000, expense: 0 },
      { period: "2026-07", income: 3_100_000, expense: 20_000 },
      { period: "2026-08", income: 0, expense: 0 },
    ]);
  });

  // Four-character keys mean years, and twelve months roll up into one.
  it("aggregates by year when the keys are years", async () => {
    await postTransaction(db, {
      date: "2025-11-01",
      title: "작년 급여",
      lines: [
        line("left", ids.bank, "KRW", 1_000_000, 1),
        line("right", ids.salary, "KRW", 1_000_000, 1),
      ],
    });
    await postTransaction(db, {
      date: "2026-02-10",
      title: "2월 급여",
      lines: [
        line("left", ids.bank, "KRW", 2_000_000, 1),
        line("right", ids.salary, "KRW", 2_000_000, 1),
      ],
    });
    await postTransaction(db, {
      date: "2026-09-30",
      title: "9월 식비",
      lines: [line("left", ids.food, "KRW", 30_000, 1), line("right", ids.card, "KRW", 30_000, 1)],
    });

    const totals = await getPeriodTotals(db, {
      sectionId: SECTION_ID,
      periods: ["2025", "2026", "2027"],
    });

    expect(totals).toEqual([
      { period: "2025", income: 1_000_000, expense: 0 },
      { period: "2026", income: 2_000_000, expense: 30_000 },
      { period: "2027", income: 0, expense: 0 },
    ]);
  });

  it("returns an empty array for an empty period list", async () => {
    expect(await getPeriodTotals(db, { sectionId: SECTION_ID, periods: [] })).toEqual([]);
  });
});

describe("getUnrealizedFx", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  it("keeps the book amount fixed at the entry rate and compares it against asOf's rate", async () => {
    await postTransaction(db, {
      date: "2026-07-20",
      title: "환전",
      lines: [
        line("left", ids.usd, "USD", 100_000, 1300),
        line("right", ids.bank, "KRW", 1_300_000, 1),
      ],
    });
    // Cached, so getOrFetchRate never needs the network.
    await db.insert(exchangeRates).values({
      date: "2026-07-31",
      base: "USD",
      quote: "KRW",
      rate: 1380,
      source: "api",
    });

    const [fx] = await getUnrealizedFx(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      asOf: "2026-07-31",
    });

    expect(fx.currency).toBe("USD");
    expect(fx.amount).toBe(100_000); // $1,000.00, unaffected by valuation
    expect(fx.bookBaseAmount).toBe(1_300_000);
    expect(fx.rateUnavailable).toBe(false);
    if (fx.rateUnavailable) throw new Error("expected a resolved rate");
    expect(fx.currentBaseAmount).toBe(1_380_000);
    expect(fx.unrealized).toBe(80_000);
    expect(fx.isFallback).toBe(false);
  });

  it("reports a foreign account as rateUnavailable instead of throwing when no rate exists", async () => {
    // No cached rate and no network: the balance sheet must still be
    // renderable, since book values don't depend on a current rate.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );

    await postTransaction(db, {
      date: "2026-07-20",
      title: "환전",
      lines: [
        line("left", ids.usd, "USD", 100_000, 1300),
        line("right", ids.bank, "KRW", 1_300_000, 1),
      ],
    });

    const [fx] = await getUnrealizedFx(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      asOf: "2026-07-31",
    });

    expect(fx.rateUnavailable).toBe(true);
    expect(fx.bookBaseAmount).toBe(1_300_000);
    vi.unstubAllGlobals();
  });

  it("omits base-currency accounts and zero-balance foreign accounts", async () => {
    await postTransaction(db, {
      date: "2026-07-01",
      title: "식비",
      lines: [line("left", ids.food, "KRW", 10_000, 1), line("right", ids.card, "KRW", 10_000, 1)],
    });

    const fx = await getUnrealizedFx(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      asOf: "2026-07-31",
    });
    expect(fx).toEqual([]);
  });
});

describe("property: the balance-sheet equation always holds", () => {
  // Deterministic PRNG so a failure is reproducible from the printed seed.
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function partition(rng: () => number, total: number, parts: number): number[] {
    if (parts === 1) return [total];
    const cuts = new Set<number>();
    while (cuts.size < parts - 1) {
      cuts.add(1 + Math.floor(rng() * (total - 1)));
    }
    const sorted = [0, ...[...cuts].sort((a, b) => a - b), total];
    return sorted.slice(1).map((v, i) => v - sorted[i]);
  }

  it("holds after many random multi-line KRW transactions", async () => {
    const seed = 20260731;
    const rng = mulberry32(seed);
    const db = await createTestDb();
    const ids = await seedSection(db);
    const pool = Object.values(ids);

    for (let i = 0; i < 150; i++) {
      const total = 1_000 + Math.floor(rng() * 500) * 1_000;
      const leftCount = 1 + Math.floor(rng() * 3);
      const rightCount = 1 + Math.floor(rng() * 3);
      const leftAmounts = partition(rng, total, leftCount);
      const rightAmounts = partition(rng, total, rightCount);

      const lines: TestLine[] = [
        ...leftAmounts.map((amt) =>
          line("left", pool[Math.floor(rng() * pool.length)], "KRW", amt, 1),
        ),
        ...rightAmounts.map((amt) =>
          line("right", pool[Math.floor(rng() * pool.length)], "KRW", amt, 1),
        ),
      ];

      await postTransaction(db, {
        date: "2026-07-01",
        title: `random-${i}`,
        lines,
      });
    }

    const balances = await getAccountBalances(db, {
      sectionId: SECTION_ID,
      asOf: "2026-12-31",
    });

    const sumOf = (groups: AccountGroup[]) =>
      balances.filter((b) => groups.includes(b.group)).reduce((acc, b) => acc + b.baseAmount, 0);

    const assetTotal = sumOf(["asset"]);
    const liabilityTotal = sumOf(["liability"]);
    const equityTotal = sumOf(["equity"]);
    const incomeTotal = sumOf(["income"]);
    const expenseTotal = sumOf(["expense"]);

    // Asset - Liability = Equity + Income - Expense, for every seed.
    expect(
      assetTotal - liabilityTotal,
      `seed=${seed}: asset(${assetTotal}) - liability(${liabilityTotal}) should equal equity(${equityTotal}) + income(${incomeTotal}) - expense(${expenseTotal})`,
    ).toBe(equityTotal + incomeTotal - expenseTotal);
  });
});

describe("getRunningBalances", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  /** Opening float so the running numbers are not all near zero. */
  async function openWithCash(amount: number) {
    return postTransaction(db, {
      date: "2026-01-01",
      title: "기초잔액",
      kind: "opening",
      lines: [
        line("left", ids.bank, "KRW", amount, 1),
        line("right", ids.opening, "KRW", amount, 1),
      ],
    });
  }

  const netWorth = (transactionIds: string[]) =>
    getRunningBalances(db, { sectionId: SECTION_ID, baseCurrency: BASE_CURRENCY, transactionIds });

  it("leaves net worth untouched by a transfer between two asset accounts", async () => {
    const opening = await openWithCash(5_000_000);
    // Moving money from one pocket to another is the case that catches a
    // sign error: the two legs must cancel exactly.
    const transfer = await postTransaction(db, {
      date: "2026-01-02",
      title: "이체",
      lines: [
        line("left", ids.usd, "USD", 100_000, 1300),
        line("right", ids.bank, "KRW", 1_300_000, 1),
      ],
    });

    const rows = await netWorth([opening, transfer]);
    const byId = new Map(rows.map((r) => [r.transactionId, r.amount]));
    expect(byId.get(opening)).toBe(5_000_000);
    expect(byId.get(transfer)).toBe(5_000_000);
  });

  it("drops net worth by the amount of a card expense", async () => {
    const opening = await openWithCash(5_000_000);
    const lunch = await postTransaction(db, {
      date: "2026-01-03",
      title: "점심",
      lines: [line("left", ids.food, "KRW", 12_000, 1), line("right", ids.card, "KRW", 12_000, 1)],
    });

    const rows = await netWorth([opening, lunch]);
    const byId = new Map(rows.map((r) => [r.transactionId, r.amount]));
    // The expense itself is neither an asset nor a liability; what moves
    // net worth is the debt it created.
    expect(byId.get(lunch)).toBe(5_000_000 - 12_000);
  });

  it("reports a liability's own balance as a positive amount owed", async () => {
    await openWithCash(5_000_000);
    const first = await postTransaction(db, {
      date: "2026-01-03",
      title: "점심",
      lines: [line("left", ids.food, "KRW", 12_000, 1), line("right", ids.card, "KRW", 12_000, 1)],
    });
    const second = await postTransaction(db, {
      date: "2026-01-04",
      title: "저녁",
      lines: [line("left", ids.food, "KRW", 20_000, 1), line("right", ids.card, "KRW", 20_000, 1)],
    });

    const rows = await getRunningBalances(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      transactionIds: [first, second],
      account: { id: ids.card, group: "liability", currency: "KRW" },
    });
    const byId = new Map(rows.map((r) => [r.transactionId, r.amount]));
    expect(byId.get(first)).toBe(12_000);
    expect(byId.get(second)).toBe(32_000);
  });

  it("reports a foreign-currency account in its own currency, not the base", async () => {
    const buy = await postTransaction(db, {
      date: "2026-01-02",
      title: "환전",
      lines: [
        line("left", ids.usd, "USD", 100_000, 1300),
        line("right", ids.bank, "KRW", 1_300_000, 1),
      ],
    });

    const [row] = await getRunningBalances(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      transactionIds: [buy],
      account: { id: ids.usd, group: "asset", currency: "USD" },
    });
    expect(row.amount).toBe(100_000); // $1,000.00, not ₩1,300,000
    expect(row.currency).toBe("USD");
  });

  it("orders two transactions sharing a date the same way the list does", async () => {
    const opening = await openWithCash(1_000_000);
    // Same date and, in a fast test, the same createdAt second — so `id`
    // is the only thing separating them. The window and the list have to
    // agree on it or the balances read as running backwards.
    const a = await postTransaction(db, {
      date: "2026-02-01",
      title: "A",
      lines: [line("left", ids.food, "KRW", 1_000, 1), line("right", ids.bank, "KRW", 1_000, 1)],
    });
    const b = await postTransaction(db, {
      date: "2026-02-01",
      title: "B",
      lines: [line("left", ids.food, "KRW", 2_000, 1), line("right", ids.bank, "KRW", 2_000, 1)],
    });

    const rows = await netWorth([opening, a, b]);
    const byId = new Map(rows.map((r) => [r.transactionId, r.amount]));
    const ordered = [a, b].sort();
    expect(byId.get(ordered[0])).toBe(1_000_000 - (ordered[0] === a ? 1_000 : 2_000));
    expect(byId.get(ordered[1])).toBe(1_000_000 - 3_000);
  });

  // What 예산 links to: 식비's running column has to add up to that
  // month's spend, not to everything ever eaten.
  it("starts a flow account's running total at `from` rather than at the book's beginning", async () => {
    const eat = (date: string, amount: number) =>
      postTransaction(db, {
        date,
        title: "식사",
        lines: [
          line("left", ids.food, "KRW", amount, 1),
          line("right", ids.card, "KRW", amount, 1),
        ],
      });
    await eat("2026-01-20", 40_000);
    const first = await eat("2026-02-03", 12_000);
    const second = await eat("2026-02-10", 20_000);

    const food = { id: ids.food, group: "expense" as const, currency: "KRW" };
    const bounded = await getRunningBalances(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      transactionIds: [first, second],
      account: food,
      from: "2026-02-01",
    });
    const byId = new Map(bounded.map((r) => [r.transactionId, r.amount]));
    expect(byId.get(first)).toBe(12_000);
    expect(byId.get(second)).toBe(32_000);

    // Without the bound, January is still in the sum — which is why a
    // level and a flow cannot share one default.
    const unbounded = await getRunningBalances(db, {
      sectionId: SECTION_ID,
      baseCurrency: BASE_CURRENCY,
      transactionIds: [first],
      account: food,
    });
    expect(unbounded[0].amount).toBe(52_000);
  });

  it("returns nothing for an empty id list without touching the database", async () => {
    expect(await netWorth([])).toEqual([]);
  });
});

describe("getMonthlyBalanceSheet", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  const krw = (accountId: string, side: LineSide, amount: number): TestLine => ({
    accountId,
    side,
    currency: "KRW",
    amount,
    rate: 1,
    baseAmount: amount,
  });

  it("carries the balance forward through months with no transactions", async () => {
    // The failure this guards against is a chart that drops to zero every
    // quiet month: a balance is a level, not a per-month sum.
    await postTransaction(db, {
      date: "2026-01-10",
      title: "기초잔액",
      kind: "opening",
      lines: [krw(ids.bank, "left", 5_000_000), krw(ids.opening, "right", 5_000_000)],
    });

    const rows = await getMonthlyBalanceSheet(db, {
      sectionId: SECTION_ID,
      months: ["2026-01", "2026-02", "2026-03"],
    });

    expect(rows.map((r) => r.netWorth)).toEqual([5_000_000, 5_000_000, 5_000_000]);
    expect(rows.map((r) => r.assets)).toEqual([5_000_000, 5_000_000, 5_000_000]);
  });

  it("reports zero for months before the book has anything in it", async () => {
    await postTransaction(db, {
      date: "2026-03-02",
      title: "기초잔액",
      kind: "opening",
      lines: [krw(ids.bank, "left", 1_000_000), krw(ids.opening, "right", 1_000_000)],
    });

    const rows = await getMonthlyBalanceSheet(db, {
      sectionId: SECTION_ID,
      months: ["2026-01", "2026-02", "2026-03"],
    });

    expect(rows.map((r) => r.netWorth)).toEqual([0, 0, 1_000_000]);
  });

  it("leaves net worth unchanged when money moves between two asset accounts", async () => {
    await postTransaction(db, {
      date: "2026-01-10",
      title: "기초잔액",
      kind: "opening",
      lines: [krw(ids.bank, "left", 5_000_000), krw(ids.opening, "right", 5_000_000)],
    });
    // Same currency both sides, so this is a pure transfer.
    await postTransaction(db, {
      date: "2026-02-10",
      title: "이체",
      lines: [krw(ids.card, "left", 1_000_000), krw(ids.bank, "right", 1_000_000)],
    });

    const rows = await getMonthlyBalanceSheet(db, {
      sectionId: SECTION_ID,
      months: ["2026-01", "2026-02"],
    });

    // Paying the card down moves an asset into a liability reduction —
    // net worth is untouched, which is the property that breaks first if
    // the liability sign is wrong.
    expect(rows[1].netWorth).toBe(5_000_000);
    expect(rows[1].assets).toBe(4_000_000);
    expect(rows[1].liabilities).toBe(-1_000_000);
  });

  it("shows a card spend as a liability that reduces net worth", async () => {
    await postTransaction(db, {
      date: "2026-01-10",
      title: "기초잔액",
      kind: "opening",
      lines: [krw(ids.bank, "left", 5_000_000), krw(ids.opening, "right", 5_000_000)],
    });
    await postTransaction(db, {
      date: "2026-01-20",
      title: "점심",
      lines: [krw(ids.food, "left", 12_000), krw(ids.card, "right", 12_000)],
    });

    const [january] = await getMonthlyBalanceSheet(db, {
      sectionId: SECTION_ID,
      months: ["2026-01"],
    });

    expect(january.assets).toBe(5_000_000);
    expect(january.liabilities).toBe(12_000);
    expect(january.netWorth).toBe(4_988_000);
  });

  it("returns nothing for an empty month list", async () => {
    expect(await getMonthlyBalanceSheet(db, { sectionId: SECTION_ID, months: [] })).toEqual([]);
  });
});

describe("getTitleTotals (거래처별 잔액)", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  const lend = (date: string, who: string, amount: number) =>
    postTransaction(db, {
      date,
      title: who,
      lines: [
        line("left", ids.receivable, "KRW", amount, 1),
        line("right", ids.bank, "KRW", amount, 1),
      ],
    });

  const repaid = (date: string, who: string, amount: number) =>
    postTransaction(db, {
      date,
      title: who,
      lines: [
        line("left", ids.bank, "KRW", amount, 1),
        line("right", ids.receivable, "KRW", amount, 1),
      ],
    });

  const balances = (params: { from?: string | null; asOf?: string } = {}) =>
    getTitleTotals(db, {
      sectionId: SECTION_ID,
      accountId: ids.receivable,
      group: "asset",
      from: params.from,
      to: params.asOf ?? "2026-12-31",
      untitledLabel: "미분류",
    });

  it("nets each counterparty's transactions and sorts by size", async () => {
    await lend("2026-03-01", "맥북에어", 500_000);
    await lend("2026-04-01", "가람미용기기", 800_000);
    await repaid("2026-05-01", "가람미용기기", 300_000);
    await lend("2026-06-01", "한석핸드폰", 200_000);

    expect(await balances()).toEqual([
      { name: "가람미용기기", amount: 500_000 },
      { name: "맥북에어", amount: 500_000 },
      { name: "한석핸드폰", amount: 200_000 },
    ]);
  });

  // The whole reason this is not filtered by the screen's period: asking
  // "who still owes me" for May alone would answer that 맥북에어 is
  // settled up, when they simply did not pay that month.
  it("is not narrowed by any period, only by the account's own start", async () => {
    await lend("2026-03-01", "맥북에어", 500_000);
    await lend("2026-05-01", "한석핸드폰", 200_000);

    expect(await balances({ from: "2026-04-01" })).toEqual([
      { name: "한석핸드폰", amount: 200_000 },
    ]);
    expect(await balances({ asOf: "2026-04-30" })).toEqual([{ name: "맥북에어", amount: 500_000 }]);
  });

  it("drops a counterparty who has settled up, since zero cannot move the total", async () => {
    await lend("2026-03-01", "맥북에어", 500_000);
    await repaid("2026-04-01", "맥북에어", 500_000);
    await lend("2026-04-02", "한석핸드폰", 200_000);

    expect(await balances()).toEqual([{ name: "한석핸드폰", amount: 200_000 }]);
  });

  // 「한석상여」 and 「한석상여(리텐션뱉)」 are one person: the
  // parenthesis says what the transfer was for, not who it was with.
  // Split apart, they would report two live half-balances for someone who
  // is in fact square.
  it("reads a counterparty without their parentheses, so a settled one still nets to zero", async () => {
    await lend("2026-03-01", "한석상여", 500_000);
    await repaid("2026-04-01", "한석상여(리텐션뱉)", 500_000);
    await lend("2026-04-02", "맥북에어", 200_000);

    expect(await balances()).toEqual([{ name: "맥북에어", amount: 200_000 }]);
  });

  it("sums the variants under the bare name, not under whichever one was posted", async () => {
    await lend("2026-03-01", "가람미용기기 (2차)", 800_000);
    await lend("2026-04-01", "가람미용기기", 200_000);

    expect(await balances()).toEqual([{ name: "가람미용기기", amount: 1_000_000 }]);
  });

  it("collects untitled transactions under one named bucket rather than losing them", async () => {
    await lend("2026-03-01", "", 100_000);
    await lend("2026-03-02", "   ", 50_000);

    expect(await balances()).toEqual([{ name: "미분류", amount: 150_000 }]);
  });

  // A liability is credit-normal, so 줄돈 has to come back positive the
  // same way the balance sheet reports it.
  it("reports a liability account in its normal-balance direction", async () => {
    await postTransaction(db, {
      date: "2026-03-01",
      title: "형",
      lines: [line("left", ids.food, "KRW", 70_000, 1), line("right", ids.card, "KRW", 70_000, 1)],
    });

    const owed = await getTitleTotals(db, {
      sectionId: SECTION_ID,
      accountId: ids.card,
      group: "liability",
      to: "2026-12-31",
      untitledLabel: "미분류",
    });
    expect(owed).toEqual([{ name: "형", amount: 70_000 }]);
  });
});

describe("getTitleSuggestions", () => {
  let db: Db;
  let ids: Record<string, string>;

  beforeEach(async () => {
    db = await createTestDb();
    ids = await seedSection(db);
  });

  const spend = (date: string, title: string, expense = "food") =>
    postTransaction(db, {
      date,
      title,
      lines: [
        line("left", ids[expense], "KRW", 10_000, 1),
        line("right", ids.card, "KRW", 10_000, 1),
      ],
    });

  it("offers each 적요 once, most recently used first, with its last pair of accounts", async () => {
    await spend("2026-01-05", "점심");
    await spend("2026-02-05", "택시", "supplies");
    await spend("2026-03-05", "점심");

    expect(await getTitleSuggestions(db, { sectionId: SECTION_ID })).toEqual([
      { title: "점심", leftAccountId: ids.food, rightAccountId: ids.card },
      { title: "택시", leftAccountId: ids.supplies, rightAccountId: ids.card },
    ]);
  });

  // The whole point of reaching for the latest row per title in SQL: a
  // 적요 used twice a year is exactly the one worth being reminded of,
  // and it is the first thing a "last N transactions" scan loses.
  it("still offers a 적요 buried under a hundred newer transactions", async () => {
    await spend("2020-01-01", "명절 선물", "supplies");
    for (let i = 0; i < 120; i++) {
      await spend(`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, `잡비 ${i}`);
    }

    const titles = (await getTitleSuggestions(db, { sectionId: SECTION_ID, limit: 500 })).map(
      (s) => s.title,
    );
    expect(titles).toContain("명절 선물");
    expect(titles.at(-1)).toBe("명절 선물");
  });

  it("folds bracketed variants into one and drops the bracket", async () => {
    await spend("2026-01-05", "커피 (스벅)");
    await spend("2026-02-05", "커피 (투썸)");

    expect(await getTitleSuggestions(db, { sectionId: SECTION_ID })).toEqual([
      { title: "커피", leftAccountId: ids.food, rightAccountId: ids.card },
    ]);
  });

  it("offers a split's 적요 but no accounts to fill from it", async () => {
    await postTransaction(db, {
      date: "2026-01-05",
      title: "장보기",
      lines: [
        line("left", ids.food, "KRW", 30_000, 1),
        line("left", ids.supplies, "KRW", 15_000, 1),
        line("right", ids.card, "KRW", 45_000, 1),
      ],
    });

    expect(await getTitleSuggestions(db, { sectionId: SECTION_ID })).toEqual([
      { title: "장보기", leftAccountId: null, rightAccountId: null },
    ]);
  });

  it("skips untitled transactions and returns nothing for an empty book", async () => {
    expect(await getTitleSuggestions(db, { sectionId: SECTION_ID })).toEqual([]);
    await spend("2026-01-05", "   ");
    expect(await getTitleSuggestions(db, { sectionId: SECTION_ID })).toEqual([]);
  });
});
