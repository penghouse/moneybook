import { describe, expect, it } from "vitest";
import type { TransactionCsvRow, AccountCsvRow } from "./csv";
import { checkAccountRow, checkTransactionGroup, groupTransactionRows } from "./csv-import";

function line(overrides: Partial<TransactionCsvRow> = {}): TransactionCsvRow {
  return {
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
    ...overrides,
  };
}

describe("groupTransactionRows", () => {
  it("groups rows by transactionKey, preserving first-seen order", () => {
    const rows = [
      line({ transactionKey: "T0002", side: "left" }),
      line({ transactionKey: "T0001", side: "left" }),
      line({ transactionKey: "T0002", side: "right" }),
      line({ transactionKey: "T0001", side: "right" }),
    ];
    const groups = groupTransactionRows(rows);
    expect(groups.map((g) => g.key)).toEqual(["T0002", "T0001"]);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(2);
  });
});

const ACCOUNTS = new Map([
  ["식비", { id: "acc_food", currency: "KRW" }],
  ["신용카드", { id: "acc_card", currency: "KRW" }],
  ["달러예금", { id: "acc_usd", currency: "USD" }],
  ["외화환산이익", { id: "acc_fxgain", currency: "KRW" }],
]);

describe("checkTransactionGroup", () => {
  it("accepts a balanced two-line group", () => {
    const group = groupTransactionRows([
      line({ side: "left", account: "식비", amount: "30000", baseAmount: "30000" }),
      line({ side: "right", account: "신용카드", amount: "30000", baseAmount: "30000" }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toHaveLength(2);
      expect(result.date).toBe("2026-07-31");
    }
  });

  it("accepts a multi-currency group balanced via baseAmount", () => {
    const group = groupTransactionRows([
      line({
        side: "left",
        account: "달러예금",
        currency: "USD",
        amount: "1000",
        rate: "1300",
        baseAmount: "1300000",
      }),
      line({
        side: "right",
        account: "신용카드",
        currency: "KRW",
        amount: "1300000",
        rate: "1",
        baseAmount: "1300000",
      }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(true);
  });

  it("accepts a revaluation group with an empty rate on the foreign leg", () => {
    const group = groupTransactionRows([
      line({
        kind: "revaluation",
        side: "left",
        account: "달러예금",
        currency: "USD",
        amount: "0",
        rate: "",
        baseAmount: "80000",
      }),
      line({
        kind: "revaluation",
        side: "right",
        account: "외화환산이익",
        currency: "KRW",
        amount: "80000",
        rate: "1",
        baseAmount: "80000",
      }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(true);
  });

  it("rejects a group referencing an unknown account", () => {
    const group = groupTransactionRows([
      line({ side: "left", account: "존재하지않음" }),
      line({ side: "right", account: "신용카드" }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toEqual({ code: "unknownAccount", value: "존재하지않음" });
  });

  it("rejects a group whose CSV currency doesn't match the account's currency", () => {
    const group = groupTransactionRows([
      line({ side: "left", account: "식비", currency: "USD" }),
      line({ side: "right", account: "신용카드" }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("currencyMismatch");
  });

  it("rejects an unbalanced group", () => {
    const group = groupTransactionRows([
      line({ side: "left", account: "식비", amount: "30000", baseAmount: "30000" }),
      line({ side: "right", account: "신용카드", amount: "20000", baseAmount: "20000" }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid date", () => {
    const group = groupTransactionRows([
      line({ date: "not-a-date", side: "left" }),
      line({ date: "not-a-date", side: "right", account: "신용카드" }),
    ])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toEqual({ code: "invalidDate", value: "not-a-date" });
  });

  it("rejects a group with fewer than two lines", () => {
    const group = groupTransactionRows([line({ side: "left" })])[0];
    const result = checkTransactionGroup(group, ACCOUNTS, "KRW");
    expect(result.ok).toBe(false);
  });
});

describe("checkAccountRow", () => {
  function accountRow(overrides: Partial<AccountCsvRow> = {}): AccountCsvRow {
    return {
      group: "expense",
      name: "취미",
      currency: "KRW",
      activeFrom: "",
      activeTo: "",
      memo: "",
      category: "",
      ...overrides,
    };
  }

  it("reports a name already in the DB as existing, not an error", () => {
    const result = checkAccountRow(accountRow(), new Set(["취미"]), new Set());
    expect(result).toMatchObject({ name: "취미", status: "existing" });
  });

  it("carries the active window across, blank meaning unbounded", () => {
    expect(
      checkAccountRow(
        accountRow({ activeFrom: "2023-01-01", activeTo: "2024-03-15" }),
        new Set(),
        new Set(),
      ),
    ).toMatchObject({ status: "new", activeFrom: "2023-01-01", activeTo: "2024-03-15" });
    expect(checkAccountRow(accountRow(), new Set(), new Set())).toMatchObject({
      activeFrom: null,
      activeTo: null,
    });
  });

  it("rejects a malformed window date, but not a blank one", () => {
    expect(
      checkAccountRow(accountRow({ activeTo: "2024-3-1" }), new Set(), new Set()),
    ).toMatchObject({ status: "error", issue: { code: "invalidDate" } });
  });

  it("rejects a window that ends before it starts", () => {
    expect(
      checkAccountRow(
        accountRow({ activeFrom: "2024-03-15", activeTo: "2023-01-01" }),
        new Set(),
        new Set(),
      ),
    ).toMatchObject({ status: "error", issue: { code: "activeRange" } });
  });

  it("reports a name repeated within the file as a duplicate error", () => {
    const result = checkAccountRow(accountRow(), new Set(), new Set(["취미"]));
    expect(result.status).toBe("error");
    expect(result.issue).toEqual({ code: "duplicateInFile" });
  });

  it("accepts a fresh name as new", () => {
    const result = checkAccountRow(accountRow({ name: "새계정" }), new Set(), new Set());
    expect(result).toMatchObject({ name: "새계정", status: "new" });
  });

  it("rejects an empty name", () => {
    const result = checkAccountRow(accountRow({ name: "  " }), new Set(), new Set());
    expect(result.status).toBe("error");
  });

  it("rejects an invalid group", () => {
    const result = checkAccountRow(accountRow({ group: "not-a-group" }), new Set(), new Set());
    expect(result.status).toBe("error");
    expect(result.issue).toEqual({ code: "invalidGroup", value: "not-a-group" });
  });

  it("rejects a malformed currency code", () => {
    const result = checkAccountRow(accountRow({ currency: "US" }), new Set(), new Set());
    expect(result.status).toBe("error");
    expect(result.issue).toEqual({ code: "invalidCurrency", value: "US" });
  });
});
