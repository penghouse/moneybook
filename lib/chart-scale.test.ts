import { describe, expect, it } from "vitest";
import { niceScale } from "./chart-scale";

describe("niceScale", () => {
  it("rounds the domain outward to whole steps", () => {
    const scale = niceScale(0, 3_472_918);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(4_000_000);
    expect(scale.ticks).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000]);
  });

  it("always reaches past the data, so a 2px line at the top is not sliced", () => {
    // The complaint this exists for: with the domain ending exactly at the
    // highest value, half the stroke sits outside the drawing.
    for (const top of [1, 999, 1_000, 1_001, 12_345_678]) {
      expect(niceScale(0, top).max).toBeGreaterThanOrEqual(top);
    }
  });

  it("steps in 1, 2 and 5 rather than whatever divides the range", () => {
    expect(niceScale(0, 8_000).ticks).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
    expect(niceScale(0, 20_000).ticks).toEqual([0, 5_000, 10_000, 15_000, 20_000]);
    expect(niceScale(0, 40_000).ticks).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
  });

  it("covers a range that crosses zero, with zero itself on a gridline", () => {
    const scale = niceScale(-1_800_000, 3_100_000);
    expect(scale.min).toBeLessThanOrEqual(-1_800_000);
    expect(scale.max).toBeGreaterThanOrEqual(3_100_000);
    expect(scale.ticks).toContain(0);
  });

  it("opens a band around a flat series instead of dividing by zero", () => {
    const scale = niceScale(5_000_000, 5_000_000);
    expect(scale.min).toBeLessThan(5_000_000);
    expect(scale.max).toBeGreaterThan(5_000_000);
    expect(scale.ticks.length).toBeGreaterThan(1);
  });

  it("gives an all-zero book a labelled axis", () => {
    const scale = niceScale(0, 0);
    expect(scale.ticks.length).toBeGreaterThan(1);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
  });

  it("lands ticks on exact multiples, with no floating-point drift", () => {
    for (const [lo, hi] of [
      [0, 7],
      [-30, 30],
      [0, 123_456_789],
      [-999_999, 1],
    ]) {
      const { ticks } = niceScale(lo, hi);
      const step = ticks[1] - ticks[0];
      for (const tick of ticks) {
        expect(Math.abs(tick / step - Math.round(tick / step))).toBeLessThan(1e-9);
      }
    }
  });

  it("returns ticks in order, evenly spaced, spanning min to max", () => {
    const { min, max, ticks } = niceScale(-2_500, 17_400);
    expect(ticks[0]).toBe(min);
    expect(ticks.at(-1)).toBe(max);
    const step = ticks[1] - ticks[0];
    ticks.forEach((tick, i) => expect(tick).toBeCloseTo(min + i * step, 6));
  });

  it("takes its arguments in either order", () => {
    expect(niceScale(9_000, 1_000)).toEqual(niceScale(1_000, 9_000));
  });
});
