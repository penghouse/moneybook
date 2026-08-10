import { describe, expect, it } from "vitest";
import { MAX_SERIES, parseSeries, serializeSeries, seriesCookieName } from "./chart-series";

const AVAILABLE = ["category:생활", "category:주거", "formula:abc", "formula:def", "category:교통"];

describe("seriesCookieName", () => {
  it("keeps the two reports' choices apart", () => {
    expect(seriesCookieName("assets")).not.toBe(seriesCookieName("income"));
  });
});

describe("serializeSeries / parseSeries", () => {
  const roundTrip = (keys: string[], available = AVAILABLE) =>
    parseSeries(serializeSeries(keys), available);

  it("round-trips a choice", () => {
    expect(roundTrip(["category:생활", "formula:abc"])).toEqual(["category:생활", "formula:abc"]);
  });

  it("survives a name that would break a delimiter", () => {
    const available = ["category:생활비,고정"];
    expect(roundTrip(["category:생활비,고정"], available)).toEqual(["category:생활비,고정"]);
  });

  it("reads the value whether or not the framework decoded it", () => {
    const keys = ["category:생활"];
    const encoded = serializeSeries(keys);
    expect(parseSeries(encoded, AVAILABLE)).toEqual(keys);
    expect(parseSeries(decodeURIComponent(encoded), AVAILABLE)).toEqual(keys);
  });

  it("drops a series the chart no longer offers", () => {
    // The 상위 그룹 was renamed, so its old key is gone. The rest stay.
    expect(parseSeries(serializeSeries(["category:없어짐", "category:주거"]), AVAILABLE)).toEqual([
      "category:주거",
    ]);
  });

  it("falls back to nothing when every stored series is gone", () => {
    // Null, not an empty list — a chart that opens blank because of a
    // rename looks broken, so the caller reverts to its default.
    expect(parseSeries(serializeSeries(["category:없어짐"]), AVAILABLE)).toBeNull();
  });

  it("never returns more than the palette has colours for", () => {
    const many = [...AVAILABLE];
    expect(parseSeries(JSON.stringify(many), AVAILABLE)!.length).toBe(MAX_SERIES);
    expect(JSON.parse(decodeURIComponent(serializeSeries(many))).length).toBe(MAX_SERIES);
  });

  it("drops duplicates rather than spending two colour slots on one series", () => {
    expect(parseSeries(JSON.stringify(["category:생활", "category:생활"]), AVAILABLE)).toEqual([
      "category:생활",
    ]);
  });

  it("refuses anything that is not a list of strings", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "{}",
      '"category:생활"',
      "42",
      "null",
      "[1, 2, 3]",
      "%E0%A4%A",
    ]) {
      expect(parseSeries(raw, AVAILABLE)).toBeNull();
    }
  });

  it("ignores non-string members but keeps the valid ones", () => {
    expect(parseSeries('["category:생활", 7, null, "formula:abc"]', AVAILABLE)).toEqual([
      "category:생활",
      "formula:abc",
    ]);
  });
});
