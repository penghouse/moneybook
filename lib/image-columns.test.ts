import { describe, expect, it } from "vitest";
import { columnCountFor, packColumns, type Sliver } from "./image-columns";

const row = (height = 10): Sliver => ({ height, header: false });
const head = (height = 10): Sliver => ({ height, header: true });

const heights = (slivers: readonly Sliver[], columns: number[][]) =>
  columns.map((column) => column.reduce((sum, i) => sum + slivers[i].height, 0));

describe("columnCountFor", () => {
  it("stays at one while the content fits", () => {
    expect(columnCountFor(900, 1000)).toBe(1);
    expect(columnCountFor(1000, 1000)).toBe(1);
  });

  it("splits once the picture stops being a picture", () => {
    expect(columnCountFor(1600, 1000)).toBe(2);
    expect(columnCountFor(2400, 1000)).toBe(3);
  });

  it("stops at three, however long the month was", () => {
    expect(columnCountFor(99_000, 1000)).toBe(3);
  });
});

describe("packColumns", () => {
  it("leaves a single column alone", () => {
    const slivers = [head(), row(), row()];
    expect(packColumns(slivers, 1)).toEqual([[0, 1, 2]]);
  });

  it("splits evenly where the heights allow", () => {
    const slivers = Array.from({ length: 8 }, () => row(10));
    const columns = packColumns(slivers, 2);

    expect(columns).toHaveLength(2);
    expect(heights(slivers, columns)).toEqual([40, 40]);
  });

  it("keeps the reading order — nothing is reshuffled to balance better", () => {
    const slivers = [row(30), row(10), row(10), row(10)];
    expect(packColumns(slivers, 2).flat()).toEqual([0, 1, 2, 3]);
  });

  it("never ends a column on a header", () => {
    // The break wants to fall right after the band heading; it has to
    // take the heading with it instead.
    const slivers = [row(10), row(10), head(10), row(10), row(10), row(10)];
    const columns = packColumns(slivers, 2);

    for (const column of columns) {
      expect(slivers[column[column.length - 1]].header).toBe(false);
    }
    expect(columns[1][0]).toBe(2);
  });

  it("does not strand a header stack either", () => {
    // A section title immediately followed by a band title: both move.
    const slivers = [row(40), head(10), head(10), row(10), row(10)];
    const columns = packColumns(slivers, 2);

    expect(columns[0]).toEqual([0]);
    expect(columns[1]).toEqual([1, 2, 3, 4]);
  });

  it("comes back in fewer columns rather than returning a blank one", () => {
    // One enormous band and two small ones cannot fill three columns
    // evenly; a narrower picture beats a column of white paper.
    const slivers = [row(100), row(1), row(1)];
    const columns = packColumns(slivers, 3);

    expect(columns.length).toBeLessThanOrEqual(3);
    for (const column of columns) expect(column.length).toBeGreaterThan(0);
  });

  it("does fill three when the content allows", () => {
    const slivers = Array.from({ length: 9 }, () => row(10));
    const columns = packColumns(slivers, 3);

    expect(columns).toHaveLength(3);
    expect(heights(slivers, columns)).toEqual([30, 30, 30]);
  });

  it("gives back every sliver exactly once, in order", () => {
    const slivers = [head(), row(20), row(5), head(), row(30), row(5), row(5), row(15)];
    for (const count of [1, 2, 3, 4]) {
      expect(packColumns(slivers, count).flat()).toEqual(slivers.map((_, i) => i));
    }
  });

  it("has nothing to pack when there is nothing", () => {
    expect(packColumns([], 3)).toEqual([[]]);
  });
});
