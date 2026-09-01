import { describe, expect, it } from "vitest";
import { baselineRange, parseBaseline, parseScope } from "./compare-period";

describe("parseBaseline", () => {
  it("takes the ones it knows", () => {
    expect(parseBaseline("year3")).toBe("year3");
    expect(parseBaseline("previous")).toBe("previous");
  });

  it("falls back rather than trusting a query string", () => {
    for (const value of [undefined, "", "year9", "year0", "직전", "__proto__"]) {
      expect(parseBaseline(value)).toBe("previous");
    }
  });
});

describe("parseScope", () => {
  it("takes the ones it knows, and falls back otherwise", () => {
    expect(parseScope("balance")).toBe("balance");
    expect(parseScope("flow")).toBe("flow");
    expect(parseScope("assets")).toBe("flow");
    expect(parseScope(undefined)).toBe("flow");
  });
});

describe("baselineRange", () => {
  it("steps back by the window's own length", () => {
    expect(baselineRange("2026-09-01", "2026-09-30", "previous")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("steps a whole year back by the window's length too, not by a year", () => {
    expect(baselineRange("2026-01-01", "2026-12-31", "previous")).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("holds an odd window against the one just before it", () => {
    // Ten days, so the previous ten days — 직전기간 does not round to a
    // month it was never asked about.
    expect(baselineRange("2026-09-11", "2026-09-20", "previous")).toEqual({
      from: "2026-09-01",
      to: "2026-09-10",
    });
  });

  it("keeps the calendar dates for a year-ago comparison", () => {
    // 이사, 명절, 보험료 land on the calendar, so this September has to
    // be held against last September rather than against a window.
    expect(baselineRange("2026-09-01", "2026-09-30", "year1")).toEqual({
      from: "2025-09-01",
      to: "2025-09-30",
    });
  });

  it("goes as far back as five years", () => {
    expect(baselineRange("2026-09-01", "2026-09-30", "year5")).toEqual({
      from: "2021-09-01",
      to: "2021-09-30",
    });
  });

  it("lands a leap day on the 28th of a year that has none", () => {
    expect(baselineRange("2024-02-29", "2024-02-29", "year1")).toEqual({
      from: "2023-02-28",
      to: "2023-02-28",
    });
  });
});
