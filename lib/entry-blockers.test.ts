import { describe, expect, it } from "vitest";
import { findEntryBlocker, type BlockerLine } from "./entry-blockers";

const line = (over: Partial<BlockerLine> = {}): BlockerLine => ({
  accountId: "a1",
  currency: "KRW",
  amountStr: "12000",
  rate: 1,
  ...over,
});

const ask = (over: Partial<Parameters<typeof findEntryBlocker>[0]> = {}) =>
  findEntryBlocker({
    lines: [line(), line({ accountId: "a2" })],
    baseCurrency: "KRW",
    date: "2026-08-24",
    windowsByAccountId: new Map(),
    balanced: true,
    nameOf: (id) => ({ a1: "식비", a2: "신용카드", a3: "달러예금" })[id] ?? id,
    ...over,
  });

describe("findEntryBlocker", () => {
  it("finds nothing wrong with a filled, balanced entry", () => {
    expect(ask()).toBeNull();
  });

  it("asks for the account before anything else", () => {
    // An account typed but never picked leaves an empty id behind a box
    // that still shows the name, which is the invisible one.
    expect(ask({ lines: [line({ accountId: "" }), line({ accountId: "a2" })] })).toEqual({
      kind: "account",
    });
  });

  it("asks for the amount once the accounts are there", () => {
    expect(ask({ lines: [line({ amountStr: "" }), line({ accountId: "a2" })] })).toEqual({
      kind: "amount",
    });
  });

  it("names the account that is closed on the date being entered", () => {
    expect(
      ask({
        date: "2026-07-15",
        windowsByAccountId: new Map([["a1", { activeFrom: "2026-08-01", activeTo: null }]]),
      }),
    ).toEqual({ kind: "inactive", name: "식비" });
  });

  it("lets the same account through on a date it is open on", () => {
    expect(
      ask({
        date: "2026-08-24",
        windowsByAccountId: new Map([["a1", { activeFrom: "2026-08-01", activeTo: null }]]),
      }),
    ).toBeNull();
  });

  it("treats an account with no window as always open", () => {
    expect(
      ask({ windowsByAccountId: new Map([["a1", { activeFrom: null, activeTo: null }]]) }),
    ).toBeNull();
  });

  it("names the currency whose rate never arrived", () => {
    // The amount is typed and the account is picked, so nothing on
    // screen looks unfinished — the totals just quietly say nothing.
    expect(
      ask({
        lines: [line({ accountId: "a3", currency: "USD", rate: null }), line({ accountId: "a2" })],
        balanced: false,
      }),
    ).toEqual({ kind: "rate", currency: "USD" });
  });

  it("does not ask for a rate in the book's own currency", () => {
    expect(
      ask({ lines: [line({ rate: null }), line({ accountId: "a2", rate: null })] }),
    ).toBeNull();
  });

  it("falls back to the totals when everything else is in order", () => {
    expect(ask({ balanced: false })).toEqual({ kind: "unbalanced" });
  });

  it("puts the closed account ahead of the missing rate", () => {
    // Both are true; the date is the one that will be refused by the
    // server, and it is the one the reader can fix without leaving.
    expect(
      ask({
        date: "2026-07-15",
        lines: [line({ accountId: "a3", currency: "USD", rate: null }), line({ accountId: "a2" })],
        windowsByAccountId: new Map([["a3", { activeFrom: "2026-08-01", activeTo: null }]]),
        balanced: false,
      }),
    ).toEqual({ kind: "inactive", name: "달러예금" });
  });
});
