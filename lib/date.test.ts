import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  addMonthsToDate,
  addYears,
  monthRange,
  monthsBetween,
  rangeUnit,
  today,
  yearMonthOf,
  yearOf,
  yearRange,
  yearsBetween,
} from "./date";

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

describe("yearRange / addYears", () => {
  it("spans a whole calendar year", () => {
    expect(yearRange("2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("steps years", () => {
    expect(addYears("2026", -1)).toBe("2025");
    expect(addYears("2026", 1)).toBe("2027");
  });

  it("reads the year off a date", () => {
    expect(yearOf("2026-08-06")).toBe("2026");
  });
});

describe("rangeUnit", () => {
  it("recognises a whole calendar month", () => {
    expect(rangeUnit("2026-08-01", "2026-08-31")).toBe("month");
    expect(rangeUnit("2026-02-01", "2026-02-28")).toBe("month");
  });

  it("recognises a whole calendar year", () => {
    expect(rangeUnit("2026-01-01", "2026-12-31")).toBe("year");
  });

  it("calls anything else custom", () => {
    expect(rangeUnit("2026-08-01", "2026-08-30")).toBe("custom");
    expect(rangeUnit("2026-01-01", "2026-06-30")).toBe("custom");
    expect(rangeUnit("2026-08-15", "2026-09-14")).toBe("custom");
  });

  it("prefers year over month for January in a one-month book", () => {
    // 2026-01-01 ~ 2026-12-31 is not also a month, so there is no real
    // ambiguity — but the year test runs first either way, which is what
    // keeps a full year from being reported as January.
    expect(rangeUnit("2026-01-01", "2026-12-31")).toBe("year");
    expect(rangeUnit("2026-01-01", "2026-01-31")).toBe("month");
  });
});

describe("monthsBetween", () => {
  it("includes both ends and every month across a year boundary", () => {
    expect(monthsBetween("2025-11-14", "2026-02-03")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns the one month a range inside a single month touches", () => {
    expect(monthsBetween("2026-08-05", "2026-08-06")).toEqual(["2026-08"]);
  });

  // A hand-typed query string does not go through the form, and a
  // reversed range used to spin until the request died.
  it("returns nothing for a reversed range instead of looping", () => {
    expect(monthsBetween("2026-08-01", "2026-01-31")).toEqual([]);
  });

  it("stops at the cap rather than building a list nobody can read", () => {
    expect(monthsBetween("1900-01-01", "2999-12-31")).toHaveLength(600);
  });
});

describe("yearsBetween", () => {
  it("includes both ends", () => {
    expect(yearsBetween("2022-06-01", "2026-02-03")).toEqual([
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
  });

  it("returns the single year a range inside one year touches", () => {
    expect(yearsBetween("2026-01-01", "2026-12-31")).toEqual(["2026"]);
  });

  it("returns nothing for a reversed range", () => {
    expect(yearsBetween("2026-01-01", "2020-12-31")).toEqual([]);
  });
});
