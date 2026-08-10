/**
 * The y-axis a chart is actually drawn against.
 *
 * Two jobs at once, and they are the same job. The gridlines have to land
 * on numbers a reader can hold — 0, 500만, 1,000만, not 3,472,918 — and
 * the axis has to reach a little past the data so a 2px line at the top
 * of the range is not sliced in half by the edge of the drawing. Rounding
 * the domain outward to whole steps does both: the headroom is whatever
 * it takes to reach the next round number, which is honest about the
 * scale in a way a flat "add 15%" is not.
 */
export interface Scale {
  /** Domain to draw against — at or below the data's own minimum. */
  min: number;
  /** Domain to draw against — at or above the data's own maximum. */
  max: number;
  /** Every gridline, `min` to `max` inclusive, evenly spaced. */
  ticks: number[];
}

/** 1, 2, 5, 10, 20, 50, … — the steps people count in. */
function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

/**
 * `target` is what it says — the step is chosen to land near that many
 * gridlines, and the outward rounding can push the count one either way.
 * Asking for exactly n would mean steps like 3,333, which defeats the
 * point.
 */
export function niceScale(dataMin: number, dataMax: number, target = 4): Scale {
  const lo = Math.min(dataMin, dataMax);
  const hi = Math.max(dataMin, dataMax);

  // A flat series has no range to round. Open a band around the value so
  // the line sits in the middle of the plot rather than on an edge, and
  // an all-zero book still gets a labelled axis rather than one tick.
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < Number.EPSILON) {
    const reach = Math.abs(hi) || 1;
    return niceScale(hi - reach, hi + reach, target);
  }

  const step = niceStep((hi - lo) / Math.max(1, target));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Counted rather than accumulated: adding a step repeatedly drifts, and
  // a tick that lands on 4999999.999999 is formatted as its neighbour.
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) ticks.push(min + i * step);

  return { min, max, ticks };
}
