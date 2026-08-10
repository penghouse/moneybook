import { formatCompactMoney } from "@/lib/money";

/**
 * How much of the viewBox the value labels take on the left.
 *
 * Shared by every chart so the three drawings on a page line up down
 * their left edge — a gutter that differed by a few units per chart would
 * read as a wobble in the column rather than as three separate drawings.
 * Wide enough for '1200만' / '-350M' at 9px.
 */
export const AXIS_GUTTER = 36;

/**
 * Gridlines and the value scale beside them.
 *
 * Recessive on purpose: hairline, solid, one step off the surface. A grid
 * is scaffolding for reading the marks, and the moment it competes with
 * them it has stopped helping. Solid rather than dashed for the same
 * reason — a dashed rule is busier at the same weight.
 *
 * Zero, when the range crosses it, gets the stronger rule: on a chart
 * with money above and below it, that line is the thing being crossed,
 * not just another gradation.
 */
export function ChartGrid({
  ticks,
  y,
  left,
  right,
  currency,
  locale,
}: {
  ticks: number[];
  /** The chart's own value-to-viewBox mapping. */
  y: (value: number) => number;
  /** Where the plot starts — labels are right-aligned just inside it. */
  left: number;
  /** Where the plot ends. */
  right: number;
  currency: string;
  locale: string;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            y1={y(tick)}
            x2={right}
            y2={y(tick)}
            className={tick === 0 ? "stroke-rule" : "stroke-rule-soft"}
            strokeWidth={1}
          />
          <text
            x={left - 4}
            // Nudged onto the rule rather than sitting on it: SVG puts the
            // baseline at y, which would leave the text reading as one
            // gridline high.
            y={y(tick) + 3}
            textAnchor="end"
            className="fill-ink-faint tnum text-[9px]"
          >
            {formatCompactMoney(tick, currency, locale)}
          </text>
        </g>
      ))}
    </g>
  );
}
