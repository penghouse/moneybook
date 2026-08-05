import { describe, expect, it } from "vitest";
import { CsvFormatError } from "./csv";
import {
  checkPairedRow,
  parsePairedCsv,
  planPairedAccounts,
  PAIRED_CSV_COLUMNS,
  type ExistingAccount,
  type PairedRow,
} from "./paired-csv";

const HEADER = PAIRED_CSV_COLUMNS.join(",");

function file(...lines: string[]): string {
  return [HEADER, ...lines].join("\n") + "\n";
}

function row(overrides: Partial<PairedRow> = {}): PairedRow {
  return {
    line: 2,
    date: "2026-08-03",
    item: "이자",
    amount: "333333",
    leftGroup: "자산",
    leftAccount: "예금",
    rightGroup: "수익",
    rightAccount: "금융수익",
    memo: "",
    ...overrides,
  };
}

describe("parsePairedCsv", () => {
  it("reads a row into its two sides and drops the running total", () => {
    const [parsed] = parsePairedCsv(
      file("2026-08-03,이자,333333,1000000,자산,예금,수익,금융수익,메모다"),
    );
    expect(parsed).toEqual({
      line: 2,
      date: "2026-08-03",
      item: "이자",
      amount: "333333",
      leftGroup: "자산",
      leftAccount: "예금",
      rightGroup: "수익",
      rightAccount: "금융수익",
      memo: "메모다",
    });
    // 기간내합계 is period-scoped and would be wrong the moment anything
    // is added, so it must not reach the caller at all.
    expect(parsed).not.toHaveProperty("runningTotal");
  });

  it("keeps a comma inside a quoted account name", () => {
    // An account name in a file like this may itself contain a comma,
    // which is the whole reason quoting has to work.
    const [parsed] = parsePairedCsv(
      file('2026-01-02,공과금,120000,0,비용,"수도,전기",자산,입출금통장,'),
    );
    expect(parsed.leftAccount).toBe("수도,전기");
    expect(parsed.rightAccount).toBe("입출금통장");
  });

  it("rejects a file whose header is not this format's", () => {
    expect(() => parsePairedCsv("date,title,amount\n2026-01-01,a,1\n")).toThrow(CsvFormatError);
  });

  it("accepts the BOM its own export is written with", () => {
    const parsed = parsePairedCsv("﻿" + file("2026-08-03,이자,100,0,자산,현금,수익,금융수익,"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].date).toBe("2026-08-03");
  });

  it("rejects a row with the wrong number of columns, naming the line", () => {
    expect(() => parsePairedCsv(file("2026-08-03,이자,100"))).toThrow(/column_count:2:9:3/);
  });

  it("numbers rows from 2, so an error points at the line in the file", () => {
    const parsed = parsePairedCsv(
      file(
        "2026-08-01,a,1,0,자산,현금,수익,금융수익,",
        "2026-08-02,b,2,0,자산,현금,수익,금융수익,",
        "2026-08-03,c,3,0,자산,현금,수익,금융수익,",
      ),
    );
    expect(parsed.map((r) => r.line)).toEqual([2, 3, 4]);
  });
});

describe("checkPairedRow", () => {
  it("maps the file's group names onto this app's groups", () => {
    const check = checkPairedRow(
      row({
        leftGroup: "비용",
        leftAccount: "식비",
        rightGroup: "부채",
        rightAccount: "신용카드",
      }),
      "KRW",
    );
    expect(check).toMatchObject({
      ok: true,
      left: { group: "expense", name: "식비" },
      right: { group: "liability", name: "신용카드" },
    });
  });

  it("treats 순자산 as equity, which is where such a file posts opening balances", () => {
    const check = checkPairedRow(
      row({
        item: "(`차량`의 기초잔액)",
        leftGroup: "자산",
        leftAccount: "차량",
        rightGroup: "순자산",
        rightAccount: "기초잔액",
      }),
      "KRW",
    );
    expect(check).toMatchObject({ ok: true, right: { group: "equity", name: "기초잔액" } });
    // Deliberately not `opening`: 순자산 is a group, not a kind, and
    // guessing would mislabel a book that posts real equity movements.
    expect(check).not.toHaveProperty("kind");
  });

  it("folds a negative amount into the sides instead of storing a negative", () => {
    const positive = checkPairedRow(row({ amount: "27296" }), "KRW");
    const negative = checkPairedRow(row({ amount: "-27296" }), "KRW");

    expect(negative).toMatchObject({ ok: true, amount: 27296 });
    // Same magnitude, the two accounts exchanged — the same journal
    // entry written the other way round.
    expect(negative).toMatchObject({
      left: (positive as { right: unknown }).right,
      right: (positive as { left: unknown }).left,
    });
  });

  it("keeps a zero-amount row: real entries are written at 0", () => {
    expect(checkPairedRow(row({ amount: "0" }), "KRW")).toMatchObject({ ok: true, amount: 0 });
  });

  it("converts to the base currency's minor units", () => {
    expect(checkPairedRow(row({ amount: "12.34" }), "USD")).toMatchObject({ amount: 1234 });
    expect(checkPairedRow(row({ amount: "1234" }), "KRW")).toMatchObject({ amount: 1234 });
  });

  it("reports a malformed date rather than importing the row", () => {
    // This exact string appears once in a real 8,719-row export.
    const check = checkPairedRow(
      row({ date: "--&g-t;- 어", item: "", amount: "", leftGroup: "", leftAccount: "" }),
      "KRW",
    );
    expect(check).toMatchObject({ ok: false, issue: { code: "invalidDate" } });
  });

  it("reports an unknown group name", () => {
    expect(checkPairedRow(row({ rightGroup: "잡이익" }), "KRW")).toMatchObject({
      ok: false,
      issue: { code: "invalidGroup", value: "잡이익" },
    });
  });

  it("reports a blank account name", () => {
    expect(checkPairedRow(row({ leftAccount: "  " }), "KRW")).toMatchObject({
      ok: false,
      issue: { code: "emptyName" },
    });
  });

  it("reports an amount that is not a number, and a blank one", () => {
    for (const amount of ["", "1,000", "abc"]) {
      expect(checkPairedRow(row({ amount }), "KRW")).toMatchObject({
        ok: false,
        issue: { code: "invalidAmount" },
      });
    }
  });

  it("carries the item across as the title and the memo as the memo", () => {
    expect(checkPairedRow(row({ item: " 우유 ", memo: " 이마트 " }), "KRW")).toMatchObject({
      title: "우유",
      memo: "이마트",
    });
  });
});

describe("planPairedAccounts", () => {
  const asset = (id: string): ExistingAccount => ({ id, group: "asset", currency: "KRW" });

  it("plans one entry per distinct name, in first-seen order", () => {
    const plans = planPairedAccounts(
      [
        { group: "asset", name: "현금" },
        { group: "expense", name: "식비" },
        { group: "asset", name: "현금" },
      ],
      new Map(),
      "KRW",
    );
    expect(plans).toEqual([
      { name: "현금", status: "new", group: "asset" },
      { name: "식비", status: "new", group: "expense" },
    ]);
  });

  it("reuses an account already in the book instead of duplicating it", () => {
    const plans = planPairedAccounts(
      [{ group: "asset", name: "현금" }],
      new Map([["현금", asset("cash-id")]]),
      "KRW",
    );
    expect(plans).toEqual([{ name: "현금", status: "existing", id: "cash-id" }]);
  });

  it("refuses a name already filed under a different group", () => {
    const plans = planPairedAccounts(
      [{ group: "expense", name: "현금" }],
      new Map([["현금", asset("cash-id")]]),
      "KRW",
    );
    expect(plans).toEqual([
      {
        name: "현금",
        status: "conflict",
        issue: { code: "accountGroupMismatch", value: "현금", expected: "asset" },
      },
    ]);
  });

  it("refuses a name the file itself uses under two groups", () => {
    // An account name is unique within a book, so there is no single
    // account to create — and picking the first-seen group would file
    // every row on the other one silently wrong.
    const plans = planPairedAccounts(
      [
        { group: "asset", name: "미수금" },
        { group: "expense", name: "미수금" },
      ],
      new Map(),
      "KRW",
    );
    expect(plans).toEqual([
      {
        name: "미수금",
        status: "conflict",
        issue: { code: "ambiguousGroup", value: "미수금" },
      },
    ]);
  });

  it("refuses an existing account held in another currency", () => {
    // The format has no currency column, so an amount on a USD account
    // could not be read at face value.
    const plans = planPairedAccounts(
      [{ group: "asset", name: "달러예금" }],
      new Map([["달러예금", { id: "usd-id", group: "asset" as const, currency: "USD" }]]),
      "KRW",
    );
    expect(plans).toEqual([
      {
        name: "달러예금",
        status: "conflict",
        issue: { code: "currencyMismatch", value: "달러예금", expected: "USD" },
      },
    ]);
  });
});
