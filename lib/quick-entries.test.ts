import { describe, expect, it } from "vitest";
import { buildQuickEntries, type QuickEntryOccurrence } from "./quick-entries";

const at = (
  title: string,
  month: string,
  over: Partial<QuickEntryOccurrence> = {},
): QuickEntryOccurrence => ({
  title,
  month,
  date: `${month}-25`,
  leftAccountId: "rent",
  rightAccountId: "bank",
  amountMajor: 1_200_000,
  ...over,
});

/** Six months behind 2026-08, oldest first. */
const past = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

const build = (occurrences: QuickEntryOccurrence[], currentMonth = "2026-08") =>
  buildQuickEntries({ occurrences, currentMonth });

describe("buildQuickEntries", () => {
  it("calls a thing that happened every month monthly, and says this month is missing", () => {
    const [rent] = build(past.map((m) => at("월세", m)));

    expect(rent).toMatchObject({
      title: "월세",
      monthly: true,
      due: true,
      months: 6,
      amountMajor: 1_200_000,
    });
  });

  it("stops asking for it once this month has one", () => {
    const [rent] = build([...past.map((m) => at("월세", m)), at("월세", "2026-08")]);
    expect(rent).toMatchObject({ monthly: true, due: false });
  });

  it("forgives a skipped month", () => {
    // Five of six. A bill that missed a month is still a bill.
    const [rent] = build(past.filter((m) => m !== "2026-04").map((m) => at("월세", m)));
    expect(rent.monthly).toBe(true);
  });

  it("does not call two months monthly", () => {
    const [entry] = build([at("점심", "2026-06"), at("점심", "2026-07")]);
    expect(entry).toMatchObject({ monthly: false, due: false, months: 2 });
  });

  it("counts a month once however many times it happened in it", () => {
    const [entry] = build([
      at("점심", "2026-07", { date: "2026-07-01" }),
      at("점심", "2026-07", { date: "2026-07-02" }),
      at("점심", "2026-07", { date: "2026-07-03" }),
    ]);
    expect(entry.months).toBe(1);
    expect(entry.monthly).toBe(false);
  });

  it("drops a subscription that stopped months ago", () => {
    // Three months of it, then nothing since March. Marking this 「아직」
    // would nag every month for something that is never coming.
    const [entry] = build([
      at("헬스장", "2026-01"),
      at("헬스장", "2026-02"),
      at("헬스장", "2026-03"),
    ]);
    expect(entry).toMatchObject({ monthly: false, due: false });
  });

  it("takes the accounts and the amount from the most recent one", () => {
    // The rent went up in July and moved to a different account.
    const [rent] = build([
      ...past.slice(0, 5).map((m) => at("월세", m)),
      at("월세", "2026-07", {
        date: "2026-07-25",
        amountMajor: 1_250_000,
        rightAccountId: "savings",
      }),
    ]);
    expect(rent).toMatchObject({ amountMajor: 1_250_000, rightAccountId: "savings" });
  });

  it("puts what is missing ahead of what is merely frequent", () => {
    const lunches = ["2026-06", "2026-07", "2026-08"].flatMap((m) =>
      [1, 2, 3, 4, 5].map((d) =>
        at("점심", m, { date: `${m}-0${d}`, amountMajor: 9000, leftAccountId: "food" }),
      ),
    );
    const rows = build([...lunches, ...past.map((m) => at("월세", m))]);

    expect(rows.map((r) => r.title)).toEqual(["월세", "점심"]);
    expect(rows[0].due).toBe(true);
  });

  it("ignores anything outside the window, including the future", () => {
    const rows = build([
      at("옛날것", "2024-12"),
      at("옛날것", "2025-01"),
      at("아직안온것", "2026-09"),
      at("아직안온것", "2026-10"),
      at("점심", "2026-06"),
      at("점심", "2026-07"),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["점심"]);
  });

  it("does not offer a one-off — one entry is not a repeat", () => {
    // A chip for the thing that was just saved is noise where the useful
    // ones go, and on a fresh book the row would be nothing else.
    expect(build([at("건강검진", "2026-07")])).toEqual([]);
  });

  it("ignores a blank 적요, which cannot be a repeat of anything", () => {
    const rows = build([
      at("   ", "2026-06"),
      at("   ", "2026-07"),
      at("점심", "2026-06"),
      at("점심", "2026-07"),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["점심"]);
  });

  it("keeps the list short enough to be a row of buttons", () => {
    const many = Array.from({ length: 20 }, (_, i) => [
      at(`항목${i}`, "2026-06"),
      at(`항목${i}`, "2026-07"),
    ]).flat();
    expect(build(many)).toHaveLength(8);
  });

  it("has nothing to offer an empty book", () => {
    expect(build([])).toEqual([]);
  });
});
