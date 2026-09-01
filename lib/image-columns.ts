/**
 * One thing to be drawn, reduced to what packing needs to know.
 *
 * `header` marks the pieces that introduce what follows — a section
 * title, a 상위 그룹 band. A column must never end on one: a heading at
 * the foot of one column with its rows at the top of the next is a
 * heading that has lost the thing it names.
 */
export interface Sliver {
  height: number;
  header: boolean;
}

/**
 * How many columns to lay the content out in.
 *
 * One column is the reading a phone wants, and it is right until the
 * picture stops being a picture: a month with two dozen items came out
 * three times taller than it was wide, which is a strip to scroll rather
 * than something to look at.
 *
 * `max` is three because a fourth column of Korean account names and two
 * won figures does not leave room for either.
 */
export function columnCountFor(total: number, target: number, max = 3): number {
  if (total <= target) return 1;
  return Math.min(max, Math.ceil(total / target));
}

/**
 * Split the slivers across `count` columns, as evenly as their order
 * allows.
 *
 * Greedy by running height rather than anything cleverer: the order is
 * the reading order — 수입 before 지출, and a 상위 그룹's rows under its
 * band — and any packing that reorders to balance better would be
 * shuffling the report to save a few pixels.
 *
 * Two rules bend the balance:
 *
 * - a column never ends on a header, so a break that would land there
 *   takes the header with it into the next column;
 * - a column is never returned empty. Where the content cannot fill the
 *   columns asked for — one enormous band and two small ones — it comes
 *   back in fewer, and the caller lays out however many it got. A blank
 *   column is worse than a narrower picture.
 */
export function packColumns(slivers: readonly Sliver[], count: number): number[][] {
  if (count <= 1 || slivers.length === 0) return [slivers.map((_, i) => i)];

  const total = slivers.reduce((sum, s) => sum + s.height, 0);
  const target = total / count;

  const columns: number[][] = [];
  let current: number[] = [];
  let height = 0;

  for (let i = 0; i < slivers.length; i++) {
    current.push(i);
    height += slivers[i].height;

    const columnsLeft = count - columns.length - 1;
    if (columnsLeft <= 0) continue;

    // Trailing headers belong to the next column, along with whatever
    // they introduce.
    let end = current.length;
    while (end > 0 && slivers[current[end - 1]].header) end--;
    if (end === 0) continue;

    // Breaking here leaves this much for the columns after it, and every
    // one of them still needs something.
    const remaining = slivers.length - i - 1 + (current.length - end);
    if (remaining < columnsLeft) continue;

    if (height >= target) {
      columns.push(current.slice(0, end));
      current = current.slice(end);
      height = current.reduce((sum, index) => sum + slivers[index].height, 0);
    }
  }

  columns.push(current);
  return columns;
}
