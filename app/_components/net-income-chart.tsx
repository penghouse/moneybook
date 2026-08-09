import { formatMoney } from "@/lib/money";

const BAR_WIDTH = 20;
const GAP = 6;
const CHART_HEIGHT = 150;
const LABEL_HEIGHT = 24;

export interface NetIncomeChartPoint {
  /** The period's full name — '2026-08' or '2026'. Read out and tabulated. */
  label: string;
  /** The axis tick, which has room for two or three characters at most. */
  tick: string;
  net: number;
}

// Rounded corners only at the data end, square at the zero baseline —
// growing up (positive) rounds the top, growing down (negative) rounds
// the bottom. A plain <rect rx> would round all four corners, which
// reads wrong where a bar meets the baseline.
function barPath(x: number, baseline: number, value: number, pxPerUnit: number): string {
  const h = Math.abs(value) * pxPerUnit;
  const r = Math.min(4, h / 2);
  if (value >= 0) {
    const top = baseline - h;
    return `M${x},${top + r} Q${x},${top} ${x + r},${top} L${x + BAR_WIDTH - r},${top} Q${x + BAR_WIDTH},${top} ${x + BAR_WIDTH},${top + r} L${x + BAR_WIDTH},${baseline} L${x},${baseline} Z`;
  }
  const bottom = baseline + h;
  return `M${x},${baseline} L${x + BAR_WIDTH},${baseline} L${x + BAR_WIDTH},${bottom - r} Q${x + BAR_WIDTH},${bottom} ${x + BAR_WIDTH - r},${bottom} L${x + r},${bottom} Q${x},${bottom} ${x},${bottom - r} Z`;
}

export function NetIncomeChart({
  points,
  currency,
  locale,
  tableCaption,
  tableLabel,
}: {
  points: NetIncomeChartPoint[];
  currency: string;
  locale: string;
  tableCaption: string;
  /** The disclosure's own label — repeating the section heading here
   *  reads as a stray caption rather than a control. */
  tableLabel: string;
}) {
  if (points.length === 0) return null;

  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.net)));
  const halfHeight = (CHART_HEIGHT - LABEL_HEIGHT) / 2;
  const pxPerUnit = halfHeight / maxAbs;
  const baseline = halfHeight;
  const width = points.length * (BAR_WIDTH + GAP) - GAP;

  const extremeIndex = points.reduce(
    (best, p, i) => (Math.abs(p.net) > Math.abs(points[best].net) ? i : best),
    0,
  );
  const lastIndex = points.length - 1;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        className="w-full"
        role="group"
        aria-label={tableCaption}
      >
        <line
          x1={0}
          y1={baseline}
          x2={width}
          y2={baseline}
          className="stroke-rule"
          strokeWidth={1}
        />
        {points.map((p, i) => {
          const x = i * (BAR_WIDTH + GAP);
          const label = `${p.label}: ${formatMoney(p.net, currency, locale)}`;
          return (
            <g key={p.label}>
              <path
                d={barPath(x, baseline, p.net, pxPerUnit)}
                className={p.net >= 0 ? "fill-positive" : "fill-negative"}
                tabIndex={0}
                role="img"
                aria-label={label}
              >
                <title>{label}</title>
              </path>
              {(i === extremeIndex || i === lastIndex) && (
                // A centred label on the first or last bar hangs off the
                // side of the viewBox and gets clipped — the most recent
                // month is always labelled, so that is not a rare case.
                <text
                  x={i === 0 ? x : i === lastIndex ? x + BAR_WIDTH : x + BAR_WIDTH / 2}
                  y={
                    p.net >= 0
                      ? baseline - Math.abs(p.net) * pxPerUnit - 4
                      : baseline + Math.abs(p.net) * pxPerUnit + 12
                  }
                  textAnchor={i === 0 ? "start" : i === lastIndex ? "end" : "middle"}
                  className="fill-ink-muted text-[10px] font-semibold"
                >
                  {formatMoney(p.net, currency, locale)}
                </text>
              )}
              <text
                x={x + BAR_WIDTH / 2}
                y={CHART_HEIGHT - 4}
                textAnchor="middle"
                className="fill-ink-faint text-[9px]"
              >
                {p.tick}
              </text>
            </g>
          );
        })}
      </svg>

      <details className="mt-1">
        <summary className="text-ink-faint flex min-h-11 cursor-pointer items-center text-xs">
          {tableLabel}
        </summary>
        <table className="w-full text-sm">
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-rule-soft border-t">
                <td className="tnum py-2">{p.label}</td>
                <td className="tnum py-2 text-right">{formatMoney(p.net, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
