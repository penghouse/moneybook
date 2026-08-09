import { describe, expect, it } from "vitest";
import {
  CsvFormatError,
  UTF8_BOM,
  buildAccountsCsv,
  buildBudgetsCsv,
  buildRatesCsv,
  buildTransactionsCsv,
  parseAccountsCsv,
  parseBudgetsCsv,
  parseCsv,
  parseRatesCsv,
  parseTransactionsCsv,
  type AccountCsvRow,
  type BudgetCsvRow,
  type RateCsvRow,
  type TransactionCsvRow,
} from "./csv";

describe("parseCsv", () => {
  it("splits plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas, quotes, and newlines", () => {
    const text = 'a,b\n"1,000","he said ""hi"""\n"line1\nline2",x\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1,000", 'he said "hi"'],
      ["line1\nline2", "x"],
    ]);
  });

  it("handles \\r\\n line endings and skips blank lines", () => {
    expect(parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("transactions csv round trip", () => {
  const rows: TransactionCsvRow[] = [
    {
      transactionKey: "T0001",
      date: "2026-07-31",
      kind: "normal",
      title: "이마트",
      side: "left",
      account: "식비",
      currency: "KRW",
      amount: "30000",
      rate: "1",
      baseAmount: "30000",
      memo: "",
      lineMemo: "",
    },
    {
      transactionKey: "T0001",
      date: "2026-07-31",
      kind: "normal",
      title: "이마트",
      side: "right",
      account: "신용카드",
      currency: "KRW",
      amount: "30000",
      rate: "1",
      baseAmount: "30000",
      memo: "",
      lineMemo: "",
    },
  ];

  it("round-trips through build/parse", () => {
    expect(parseTransactionsCsv(buildTransactionsCsv(rows))).toEqual(rows);
  });

  it("preserves an empty rate (revaluation legs)", () => {
    const revalRows: TransactionCsvRow[] = [
      {
        ...rows[0],
        kind: "revaluation",
        side: "left",
        account: "달러예금",
        currency: "USD",
        amount: "0",
        rate: "",
        baseAmount: "80000",
      },
      { ...rows[1], kind: "revaluation" },
    ];
    expect(parseTransactionsCsv(buildTransactionsCsv(revalRows))).toEqual(revalRows);
  });

  it("throws CsvFormatError on the wrong column count", () => {
    expect(() => parseTransactionsCsv("a,b,c\n1,2,3\n")).toThrow(CsvFormatError);
  });

  it("round-trips a per-line memo", () => {
    const withMemo: TransactionCsvRow[] = [
      { ...rows[0], lineMemo: "3층 델리" },
      { ...rows[1], lineMemo: "" },
    ];
    expect(parseTransactionsCsv(buildTransactionsCsv(withMemo))).toEqual(withMemo);
  });

  it("re-imports its own BOM-prefixed export", () => {
    const text = buildTransactionsCsv(rows);
    expect(text.startsWith(UTF8_BOM)).toBe(true);
    expect(parseTransactionsCsv(text)).toEqual(rows);
  });

  it("rejects a headerless file instead of silently eating its first row", () => {
    const headerless =
      "T1,2026-07-31,normal,점심,,left,식비,KRW,12000,1,12000,\r\n" +
      "T1,2026-07-31,normal,점심,,right,신용카드,KRW,12000,1,12000,\r\n";
    expect(() => parseTransactionsCsv(headerless)).toThrow(CsvFormatError);
  });

  it("rejects a file whose header columns are in the wrong order", () => {
    const swapped = buildTransactionsCsv(rows).replace(
      "transactionKey,date",
      "date,transactionKey",
    );
    expect(() => parseTransactionsCsv(swapped)).toThrow(CsvFormatError);
  });
});

describe("accounts csv round trip", () => {
  const rows: AccountCsvRow[] = [
    {
      group: "expense",
      name: "식비",
      currency: "KRW",
      activeFrom: "",
      activeTo: "",
      memo: "",
      category: "먹는 것",
      tracksCounterparties: "",
    },
    {
      group: "asset",
      name: "달러예금",
      currency: "USD",
      activeFrom: "2023-01-01",
      activeTo: "2024-03-15",
      memo: "환전용",
      category: "",
      tracksCounterparties: "1",
    },
  ];

  it("round-trips through build/parse", () => {
    expect(parseAccountsCsv(buildAccountsCsv(rows))).toEqual(rows);
  });

  it("throws CsvFormatError on the wrong column count", () => {
    expect(() => parseAccountsCsv("a\n1,2\n")).toThrow(CsvFormatError);
  });

  // The silent case that made header validation necessary: an accounts
  // file without a header used to lose its first account with no error
  // shown anywhere in the preview.
  it("rejects a headerless file rather than dropping the first account", () => {
    const headerless = "expense,식비,KRW,0,,\r\nexpense,교통비,KRW,0,,\r\n";
    expect(() => parseAccountsCsv(headerless)).toThrow(CsvFormatError);
  });
});

describe("budgets csv round trip", () => {
  const rows: BudgetCsvRow[] = [
    { account: "식비", period: "2026-07", amount: "300000" },
    { account: "교통비", period: "2026-08", amount: "50000" },
    // A year budget travels in the same column — its shape is what says so.
    { account: "식비", period: "2026", amount: "3600000" },
  ];

  it("round-trips through build/parse", () => {
    expect(parseBudgetsCsv(buildBudgetsCsv(rows))).toEqual(rows);
  });
});

describe("exchange rates csv round trip", () => {
  const rows: RateCsvRow[] = [
    { date: "2026-07-31", base: "USD", quote: "KRW", rate: "1380", source: "api" },
    { date: "2026-07-31", base: "EUR", quote: "KRW", rate: "1495.5", source: "manual" },
  ];

  it("round-trips through build/parse", () => {
    expect(parseRatesCsv(buildRatesCsv(rows))).toEqual(rows);
  });
});
