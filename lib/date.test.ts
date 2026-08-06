import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, addMonthsToDate, monthRange, today, yearMonthOf } from "./date";

describe("today", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the section's timezone, not the server's UTC date", () => {
    // 23:00 UTC on 2026-07-31 is already 08:00 on 2026-08-01 in Seoul.
    // A UTC-server bug (naive `new Date().toISOString().slice(0,10)`)
    // would say 2026-07-31 here; this must not.
    vi.setSystemTime(new Date("2026-07-31T23:00:00Z"));

    expect(today("Asia/Seoul")).toBe("2026-08-01");
    expect(today("UTC")).toBe("2026-07-31");
    // Same instant, different timezone -> different calendar date.
    expect(today("America/New_York")).toBe("2026-07-31");
  });
});

describe("yearMonthOf", () => {
  it("extracts YYYY-MM from a calendar date", () => {
    expect(yearMonthOf("2026-07-31")).toBe("2026-07");
  });
});

describe("monthRange", () => {
  it("covers the full calendar month, including leap Februarys", () => {
    expect(monthRange("2026-07")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(monthRange("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(monthRange("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
});

describe("addMonths", () => {
  it("shifts by delta months, wrapping the year in both directions", () => {
    expect(addMonths("2026-07", 1)).toBe("2026-08");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-07", -12)).toBe("2025-07");
    expect(addMonths("2026-07", 0)).toBe("2026-07");
  });
});

describe("addDays", () => {
  it("steps across a month boundary", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("steps across a year boundary and a leap day", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("returns the same date for a zero delta", () => {
    expect(addDays("2026-08-05", 0)).toBe("2026-08-05");
  });
});

describe("addMonthsToDate", () => {
  it("keeps the day when the target month has one", () => {
    expect(addMonthsToDate("2026-08-06", -1)).toBe("2026-07-06");
    expect(addMonthsToDate("2026-08-06", 1)).toBe("2026-09-06");
  });

  it("clamps to the last day rather than overflowing into the next month", () => {
    // The naive `setMonth` gives 2026-03-03 here, which makes a month
    // arrow skip February entirely.
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsToDate("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(addMonthsToDate("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonthsToDate("2026-12-15", 1)).toBe("2027-01-15");
  });
});
