import { describe, expect, it } from "vitest";
import { CsvFormatError } from "./csv";
import {
  checkPeriodBudgetRow,
  parsePeriodBudgetCsv,
  periodKeyOf,
  PERIOD_BUDGET_CSV_COLUMNS,
  type PeriodBudgetRow,
} from "./period-budget-csv";

const HEADER = PERIOD_BUDGET_CSV_COLUMNS.join(",");
const file = (...lines: string[]) => `${HEADER}\n${lines.join("\n")}\n`;

/** Made-up items on made-up amounts; only the shape is the real thing. */
const SAMPLE = file(
  "2026-01-01,2026-01-31,비용,총,900000,880000,20000",
  "2026-01-01,2026-01-31,비용,총 고정,300000,310000,-10000",
  "2026-01-01,2026-01-31,비용,생활,600000,570000,30000",
  "2026-01-01,2026-01-31,비용,식비,400000,380000,20000",
  "2026-01-01,2026-01-31,비용,교통비,200000,190000,10000",
  "2026-01-01,2026-01-31,비용,통신비,300000,310000,-10000",
  "2026-01-01,2026-01-31,수익,급여,3000000,3000000,0",
);

const accounts = new Map([
  ["expense 식비", "food"],
  ["expense 교통비", "transport"],
  ["expense 통신비", "phone"],
  ["income 급여", "salary"],
]);

function row(overrides: Partial<PeriodBudgetRow> = {}): PeriodBudgetRow {
  return {
    line: 2,
    from: "2026-01-01",
    to: "2026-01-31",
    group: "비용",
    item: "식비",
    budget: "400000",
    ...overrides,
  };
}

const check = (overrides: Partial<PeriodBudgetRow> = {}) =>
  checkPeriodBudgetRow(row(overrides), "KRW", accounts);

describe("parsePeriodBudgetCsv", () => {
  it("reads a row and numbers it by its line in the file", () => {
    const rows = parsePeriodBudgetCsv(SAMPLE);

    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ line: 2, from: "2026-01-01", group: "비용", item: "총" });
    expect(rows[3]).toMatchObject({ line: 5, item: "식비", budget: "400000" });
  });

  it("refuses a file whose header is not this format's", () => {
    expect(() => parsePeriodBudgetCsv("account,period,amount\n식비,2026-01,400000\n")).toThrow(
      CsvFormatError,
    );
  });

  it("names the row when one has the wrong number of columns", () => {
    expect(() => parsePeriodBudgetCsv(file("2026-01-01,2026-01-31,비용"))).toThrow(
      /column_count:2:7:3/,
    );
  });

  it("reads an item whose name contains a comma", () => {
    const [parsed] = parsePeriodBudgetCsv(
      file('2026-01-01,2026-01-31,비용,"통신,인터넷",120000,118000,2000'),
    );
    expect(parsed.item).toBe("통신,인터넷");
  });

  it("strips the BOM a spreadsheet export leaves on the first heading", () => {
    const parsed = parsePeriodBudgetCsv(
      "﻿" + file("2026-01-01,2026-01-31,비용,식비,400000,380000,20000"),
    );
    expect(parsed[0].item).toBe("식비");
  });

  it("has nothing to say about an empty file", () => {
    expect(parsePeriodBudgetCsv("")).toEqual([]);
  });
});

describe("periodKeyOf", () => {
  it("reads a whole month as a month budget", () => {
    expect(periodKeyOf("2026-01-01", "2026-01-31")).toBe("2026-01");
    expect(periodKeyOf("2026-04-01", "2026-04-30")).toBe("2026-04");
  });

  it("gets February right in both kinds of year", () => {
    expect(periodKeyOf("2026-02-01", "2026-02-28")).toBe("2026-02");
    expect(periodKeyOf("2024-02-01", "2024-02-29")).toBe("2024-02");
    expect(periodKeyOf("2026-02-01", "2026-02-29")).toBeNull();
  });

  it("reads a whole year as a year budget", () => {
    expect(periodKeyOf("2026-01-01", "2026-12-31")).toBe("2026");
  });

  it("refuses a range that is neither, rather than rounding it", () => {
    // Half of January is not January's budget, and a 다음 달 that starts
    // on the 15th is not a month at all.
    expect(periodKeyOf("2026-01-01", "2026-01-15")).toBeNull();
    expect(periodKeyOf("2026-01-15", "2026-02-14")).toBeNull();
    expect(periodKeyOf("2026-01-01", "2027-06-30")).toBeNull();
    expect(periodKeyOf("2026-01", "2026-01-31")).toBeNull();
    expect(periodKeyOf("", "")).toBeNull();
  });
});

describe("checkPeriodBudgetRow", () => {
  it("takes the row when its item names an account this book keeps", () => {
    expect(check()).toEqual({
      ok: true,
      line: 2,
      accountId: "food",
      periodKey: "2026-01",
      amount: 400_000,
    });
  });

  it("passes over the file's own subtotals", () => {
    for (const item of ["총", "총 고정", "총 유동"]) {
      expect(check({ item })).toMatchObject({ ok: false, skipped: true });
    }
  });

  it("keeps an account whose name merely starts with the same syllable", () => {
    const withOffice = new Map([...accounts, ["expense 총무비", "office"]]);
    expect(checkPeriodBudgetRow(row({ item: "총무비" }), "KRW", withOffice)).toMatchObject({
      ok: true,
      accountId: "office",
    });
  });

  it("passes over a 상위 그룹's running total", () => {
    // 생활 sums the rows under it and is not an account here, so there is
    // nothing to file its figure against.
    expect(check({ item: "생활" })).toMatchObject({ ok: false, skipped: true, item: "생활" });
  });

  it("passes over groups a budget cannot belong to", () => {
    for (const group of ["자산", "부채", "순자산", ""]) {
      expect(check({ group })).toMatchObject({ ok: false, skipped: true });
    }
  });

  it("will not let a 비용 row land on an income account of the same name", () => {
    // Both sides can hold a 임대료 — one paid on the flat you live in and
    // one collected on the one you let — and putting the spending plan on
    // the earning account would be silent nonsense.
    const both = new Map([
      ["expense 임대료", "rent-paid"],
      ["income 임대료", "rent-earned"],
    ]);
    expect(checkPeriodBudgetRow(row({ item: "임대료" }), "KRW", both)).toMatchObject({
      accountId: "rent-paid",
    });
    expect(checkPeriodBudgetRow(row({ group: "수익", item: "임대료" }), "KRW", both)).toMatchObject(
      {
        accountId: "rent-earned",
      },
    );
  });

  it("reports a bad period on a row that really is about an account", () => {
    const result = check({ to: "2026-01-15" });
    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      issue: { code: "invalidPeriod", value: "2026-01-01~2026-01-15" },
    });
  });

  it("reports an amount that is not a number, or is below zero", () => {
    for (const budget of ["", "abc", "-100"]) {
      expect(check({ budget })).toMatchObject({ ok: false, skipped: false });
    }
  });

  it("takes a budget of exactly zero, which is a real setting", () => {
    expect(check({ budget: "0" })).toMatchObject({ ok: true, amount: 0 });
  });

  it("reads the amount in the section's own minor units", () => {
    expect(checkPeriodBudgetRow(row({ budget: "1234" }), "KRW", accounts)).toMatchObject({
      amount: 1234,
    });
    expect(checkPeriodBudgetRow(row({ budget: "12.34" }), "USD", accounts)).toMatchObject({
      amount: 1234,
    });
  });

  it("takes a whole year's row as a year budget", () => {
    expect(check({ to: "2026-12-31" })).toMatchObject({ ok: true, periodKey: "2026" });
  });
});
