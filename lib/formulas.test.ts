import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  parseTermKey,
  parseTerms,
  serializeTerms,
  termKey,
  type FormulaTerm,
} from "./formulas";

const account = (id: string, sign: 1 | -1 = 1): FormulaTerm => ({
  sign,
  kind: "account",
  accountId: id,
});

describe("termKey / parseTermKey", () => {
  it("round-trips each kind of reference", () => {
    const refs = [
      { kind: "account", accountId: "abc-123" },
      { kind: "category", group: "asset", name: "유동성자금" },
      { kind: "total", total: "netWorth" },
    ] as const;
    for (const ref of refs) {
      expect(parseTermKey(termKey(ref))).toEqual(ref);
    }
  });

  // A 상위 그룹 is free text the reader typed, so the delimiter can and
  // will appear inside a name.
  it("keeps a colon that belongs to the category's name", () => {
    const ref = { kind: "category", group: "expense", name: "생활비:고정" } as const;
    expect(termKey(ref)).toBe("category:expense:생활비:고정");
    expect(parseTermKey(termKey(ref))).toEqual(ref);
  });

  it("refuses a key that names nothing real", () => {
    for (const key of ["", "account", "account:", "total:profit", "category:banana:x", "nope:1"]) {
      expect(parseTermKey(key), key).toBeNull();
    }
  });
});

describe("parseTerms", () => {
  it("round-trips what serializeTerms wrote", () => {
    const terms: FormulaTerm[] = [
      { sign: 1, kind: "category", group: "asset", name: "유동성자금" },
      { sign: -1, kind: "account", accountId: "abc" },
      { sign: 1, kind: "total", total: "assets" },
    ];
    expect(parseTerms(serializeTerms(terms))).toEqual(terms);
  });

  it("treats an empty or unreadable column as no terms rather than throwing", () => {
    for (const stored of ["", null, undefined, "[]", "not json", "{}", '"x"', "123"]) {
      expect(parseTerms(stored), String(stored)).toEqual([]);
    }
  });

  // The column outlives the code that wrote it: a term from a version
  // that knew more kinds has to drop out, not take the report with it.
  it("drops terms it cannot read and keeps the rest", () => {
    const stored = JSON.stringify([
      { sign: 1, kind: "account", accountId: "keep" },
      { sign: 1, kind: "quantum", ticker: "???" },
      { sign: 0, kind: "account", accountId: "no-sign" },
      { sign: 1, kind: "account" },
      { sign: -1, kind: "category", group: "not-a-group", name: "x" },
      { sign: -1, kind: "total", total: "vibes" },
      null,
      "nope",
      { sign: -1, kind: "total", total: "netWorth" },
    ]);
    expect(parseTerms(stored)).toEqual([
      { sign: 1, kind: "account", accountId: "keep" },
      { sign: -1, kind: "total", total: "netWorth" },
    ]);
  });

  it("keeps the first of a repeated reference, so nothing is counted twice", () => {
    const stored = JSON.stringify([account("a"), account("a", -1), account("b", -1)]);
    expect(parseTerms(stored)).toEqual([account("a"), account("b", -1)]);
  });
});

describe("evaluateFormula", () => {
  const values = {
    byKey: new Map([
      ["category:asset:유동성자금", 400_000_000],
      ["category:asset:투자", 300_000_000],
      ["category:asset:묶인돈", 100_000_000],
    ]),
  };

  it("sums the terms with their signs when there is no expression", () => {
    const outcome = evaluateFormula(
      {
        terms: [
          { sign: 1, kind: "category", group: "asset", name: "유동성자금" },
          { sign: 1, kind: "category", group: "asset", name: "투자" },
          { sign: -1, kind: "category", group: "asset", name: "묶인돈" },
        ],
        expression: "",
      },
      values,
      "KRW",
    );
    expect(outcome).toEqual({ ok: true, amount: 600_000_000, missing: 0 });
  });

  it("runs the expression on the sum", () => {
    const outcome = evaluateFormula(
      {
        terms: [{ sign: 1, kind: "category", group: "asset", name: "유동성자금" }],
        expression: "(x+1150000000-310000000+300000000)/2",
      },
      values,
      "KRW",
    );
    expect(outcome).toEqual({ ok: true, amount: 770_000_000, missing: 0 });
  });

  // A deleted account must not silently zero the whole formula, and it
  // must not be invisible either — the screen says how many went.
  it("counts a term the report no longer has instead of failing", () => {
    const outcome = evaluateFormula(
      {
        terms: [
          { sign: 1, kind: "category", group: "asset", name: "유동성자금" },
          account("deleted-since"),
        ],
        expression: "",
      },
      values,
      "KRW",
    );
    expect(outcome).toEqual({ ok: true, amount: 400_000_000, missing: 1 });
  });

  it("reports a broken expression rather than a number", () => {
    const outcome = evaluateFormula({ terms: [], expression: "x/0" }, values, "KRW");
    expect(outcome).toEqual({ ok: false, error: { kind: "notFinite" }, missing: 0 });
  });

  // The reader types the amounts they can see, so the arithmetic is in
  // major units even where the ledger keeps minor ones.
  it("does its arithmetic in the units on screen, not in cents", () => {
    const outcome = evaluateFormula(
      { terms: [account("usd")], expression: "x+10" },
      { byKey: new Map([["account:usd", 250]]) }, // $2.50
      "USD",
    );
    expect(outcome).toEqual({ ok: true, amount: 1_250, missing: 0 }); // $12.50
  });
});
