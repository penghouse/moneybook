import { formatMoney } from "@/lib/money";

const WIDTH = 320;
const PLOT_HEIGHT = 150;
const LABEL_HEIGHT = 22;
const HEIGHT = PLOT_HEIGHT + LABEL_HEIGHT;
const PAD_X = 6;

export interface NetWorthPoint {
  yearMonth: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

/**
 * The balance sheet over the last twelve months: assets, liabilities and
 * the net worth they produce, on one shared axis.
 *
 * Lines rather than bars — these are *levels*, and a bar per month
 * invites reading each month as an independent quantity when what
 * matters is the shape of the path between them. On one axis the gap
 * between the assets line and the net worth line is the liabilities,
 * which is the relationship the chart exists to show; a second y-scale
 * would break that and is never worth it.
 *
 * The cost of sharing the axis: liabilities usually sit near zero, so
 * the axis effectively starts there and the net worth line is less steep
 * than it would be alone. That is the price of the three being
 * comparable, and the labelled endpoint and the table carry the exact
 * numbers either way.
 *
 * **Net worth is drawn in ink, not a third series colour.** It is not a
 * peer of the other two — it is what they add up to — and a total drawn
 * in ink is the same convention as a bold total row in a table. It is
 * also the only option that survived the palette gates: a third hue was
 * validated against the two existing tokens and blue collapsed against
 * the indigo (normal-vision ΔE 14.7, floor 15), magenta against the
 * orange (12.9), teal fell under the chroma floor, and the one hue that
 * passed was green — which this app reserves for income.
 */
export function NetWorthChart({
  points,
  currency,
  locale,
  tableCaption,
  tableLabel,
  assetsLabel,
  liabilitiesLabel,
  netWorthLabel,
}: {
  points: NetWorthPoint[];
  currency: string;
  locale: string;
  tableCaption: string;
  /** The disclosure's own label — repeating the section heading here
   *  reads as a stray caption rather than a control. */
  tableLabel: string;
  assetsLabel: string;
  liabilitiesLabel: string;
  netWorthLabel: string;
}) {
  if (points.length === 0) return null;

  const values = points.flatMap((p) => [p.assets, p.liabilities, p.netWorth]);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  // A flat book would divide by zero; a nonzero span keeps the lines
  // centred instead of collapsing onto an edge.
  const padding = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.15;
  const max = rawMax + padding;
  const min = rawMin - padding;
  const span = max - min;

  const stepX = points.length > 1 ? (WIDTH - PAD_X * 2) / (points.length - 1) : 0;
  const x = (i: number) => PAD_X + i * stepX;
  const y = (value: number) => PLOT_HEIGHT - ((value - min) / span) * (PLOT_HEIGHT - 26) - 13;

  const lastIndex = points.length - 1;
  const zeroY = y(0);

  const path = (pick: (p: NetWorthPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(pick(p))}`).join(" ");

  // Net worth last, so it sits on top where the lines cross. Only it
  // carries an end label: three values stacked at the right edge would
  // collide, and it is the one the page is about.
  //
  // Every class is written out in full. Tailwind v4 scans source text for
  // candidates rather than evaluating it, so a class assembled at runtime
  // — `fill.replace("fill-", "bg-")` — is never generated, and the legend
  // silently lost two of its three dots.
  const series = [
    {
      key: "assets",
      pick: (p: NetWorthPoint) => p.assets,
      stroke: "stroke-series-1",
      fill: "fill-series-1",
      dot: "bg-series-1",
      label: assetsLabel,
    },
    {
      key: "liabilities",
      pick: (p: NetWorthPoint) => p.liabilities,
      stroke: "stroke-series-2",
      fill: "fill-series-2",
      dot: "bg-series-2",
      label: liabilitiesLabel,
    },
    {
      key: "netWorth",
      pick: (p: NetWorthPoint) => p.netWorth,
      stroke: "stroke-ink",
      fill: "fill-ink",
      dot: "bg-ink",
      label: netWorthLabel,
    },
  ] as const;

  return (
    <div>
      {/* Three series, so a legend is mandatory — identity never rests on
          colour matching alone. The text wears ink tokens; the coloured
          dot beside it carries the identity. */}
      <div className="text-ink-muted mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`${s.dot} inline-block size-2.5 rounded-full`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="group"
        aria-label={tableCaption}
      >
        {/* Hairline zero rule, only when the range actually crosses it. */}
        {rawMin < 0 && rawMax > 0 && (
          <line x1={0} y1={zeroY} x2={WIDTH} y2={zeroY} className="stroke-rule" strokeWidth={1} />
        )}

        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.pick)}
            fill="none"
            className={s.stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {series.map((s) =>
          points.map((p, i) => {
            const isNetWorth = s.key === "netWorth";
            const isEnd = i === lastIndex;
            const label = `${p.yearMonth} ${s.label}: ${formatMoney(s.pick(p), currency, locale)}`;
            return (
              <g key={`${s.key}-${p.yearMonth}`}>
                {/* The ring is the surface colour, so a dot stays legible
                    where two lines cross. */}
                <circle
                  cx={x(i)}
                  cy={y(s.pick(p))}
                  r={isNetWorth && isEnd ? 4 : 2.5}
                  className={`${s.fill} stroke-card`}
                  strokeWidth={2}
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                >
                  <title>{label}</title>
                </circle>
                {isNetWorth && isEnd && (
                  <text
                    x={x(i)}
                    // Below the point, not above: net worth can never
                    // exceed assets, so the space above the last point is
                    // exactly where the assets line ends up and a label
                    // there lands on top of it.
                    y={Math.min(y(s.pick(p)) + 14, PLOT_HEIGHT - 2)}
                    // Anchored inward: centred on the last point it would
                    // hang off the viewBox and get cropped mid-digit.
                    textAnchor="end"
                    className="fill-ink text-[10px] font-semibold"
                  >
                    {formatMoney(s.pick(p), currency, locale)}
                  </text>
                )}
              </g>
            );
          }),
        )}

        {points.map((p, i) =>
          // Every other month: twelve labels collide at 360px.
          i % 2 === lastIndex % 2 ? (
            <text
              key={`tick-${p.yearMonth}`}
              x={x(i)}
              y={HEIGHT - 5}
              textAnchor={i === 0 ? "start" : i === lastIndex ? "end" : "middle"}
              className="fill-ink-faint text-[9px]"
            >
              {p.yearMonth.slice(2).replace("-", ".")}
            </text>
          ) : null,
        )}
      </svg>

      <details className="mt-1">
        <summary className="text-ink-faint flex min-h-11 cursor-pointer items-center text-xs">
          {tableLabel}
        </summary>
        <table className="w-full text-sm">
          {/* Three unlabelled number columns would be unreadable. */}
          <thead>
            <tr className="text-ink-faint border-rule-soft border-t text-xs">
              <th scope="col" className="py-2 text-left font-medium" />
              <th scope="col" className="py-2 text-right font-medium">
                {assetsLabel}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {liabilitiesLabel}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {netWorthLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.yearMonth} className="border-rule-soft border-t">
                <th scope="row" className="tnum py-2 text-left font-normal">
                  {p.yearMonth}
                </th>
                <td className="tnum py-2 text-right">{formatMoney(p.assets, currency, locale)}</td>
                <td className="tnum py-2 text-right">
                  {formatMoney(p.liabilities, currency, locale)}
                </td>
                <td className="tnum py-2 text-right">
                  {formatMoney(p.netWorth, currency, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
