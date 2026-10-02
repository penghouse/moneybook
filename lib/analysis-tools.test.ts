import { describe, expect, it } from "vitest";
import {
  parseProposal,
  parseReadMonths,
  parseReadTransactions,
  proposalFits,
  READ_MONTH_LIMIT,
  resolveAccount,
} from "./analysis-tools";

describe("parseReadTransactions", () => {
  it("takes a window the reader could be looking at", () => {
    expect(
      parseReadTransactions({ account: " 교통비 ", from: "2026-08-01", to: "2026-08-31" }),
    ).toEqual({ account: "교통비", from: "2026-08-01", to: "2026-08-31" });
  });

  it("refuses a window wide enough to be the whole book", () => {
    // The question is always about a period on screen. Years of entries
    // coming back is data leaving for a question nobody asked.
    expect(
      parseReadTransactions({ account: "식비", from: "2009-01-01", to: "2026-08-31" }),
    ).toBeNull();
  });

  it("refuses what is not a date, or a range running backwards", () => {
    expect(
      parseReadTransactions({ account: "식비", from: "2026-08", to: "2026-08-31" }),
    ).toBeNull();
    expect(
      parseReadTransactions({ account: "식비", from: "2026-08-31", to: "2026-08-01" }),
    ).toBeNull();
    expect(parseReadTransactions({ from: "2026-08-01", to: "2026-08-31" })).toBeNull();
  });
});

describe("parseReadMonths", () => {
  it("caps the look-back rather than refusing it", () => {
    expect(parseReadMonths({ account: "식비", months: 300 })).toEqual({
      account: "식비",
      months: READ_MONTH_LIMIT,
    });
  });

  it("refuses nonsense", () => {
    expect(parseReadMonths({ account: "식비", months: 0 })).toBeNull();
    expect(parseReadMonths({ account: "", months: 3 })).toBeNull();
  });
});

describe("parseProposal", () => {
  it("keeps the rows it can read and drops the rest", () => {
    expect(
      parseProposal({
        changes: [
          { account: "교통비", amount: 150000, why: "출장이 반복됨" },
          { account: "식비", amount: -1, why: "음수" },
          { account: "", amount: 1000, why: "이름 없음" },
          "문자열",
        ],
      }),
    ).toEqual([{ account: "교통비", amount: 150000, why: "출장이 반복됨" }]);
  });

  it("is nothing at all when there is no list", () => {
    expect(parseProposal({})).toBeNull();
  });
});

describe("resolveAccount", () => {
  const catalog = [
    { id: "a", name: "교통비" },
    { id: "b", name: "식비" },
    { id: "c", name: "식비" },
  ];

  it("finds the one account that bears the name", () => {
    expect(resolveAccount(catalog, " 교통비 ")).toEqual({ ok: true, id: "a", name: "교통비" });
  });

  it("refuses a name two accounts share, rather than picking one", () => {
    // Nothing in the schema stops two accounts sharing a name, and a
    // guess writes the right number onto the wrong line.
    expect(resolveAccount(catalog, "식비")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("refuses a name the book does not have", () => {
    expect(resolveAccount(catalog, "주식")).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("proposalFits", () => {
  it("passes an ordinary adjustment", () => {
    expect(proposalFits(88_000, 150_000)).toBe(true);
    expect(proposalFits(620_000, 500_000)).toBe(true);
  });

  it("catches a decimal point in the wrong place", () => {
    expect(proposalFits(88_000, 8_800_000)).toBe(false);
  });

  it("refuses a plan to spend less than nothing", () => {
    expect(proposalFits(88_000, -1)).toBe(false);
  });

  it("has nothing to compare an unbudgeted item against, and says so by allowing it", () => {
    expect(proposalFits(undefined, 500_000)).toBe(true);
    expect(proposalFits(0, 500_000)).toBe(true);
  });
});
