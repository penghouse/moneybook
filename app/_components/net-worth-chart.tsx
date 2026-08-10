"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { niceScale } from "@/lib/chart-scale";
import { AXIS_GUTTER, ChartGrid } from "./chart-axis";

const WIDTH = 320;
const PLOT_HEIGHT = 150;
const LABEL_HEIGHT = 22;
const HEIGHT = PLOT_HEIGHT + LABEL_HEIGHT;
const PAD_RIGHT = 6;
/**
 * Headroom above the top gridline, for that gridline's own label. SVG
 * puts a text baseline at y, so a label on a rule at y=0 has its whole
 * ascender outside the viewBox and renders sliced in half.
 */
const PLOT_TOP = 9;

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
 * comparable, and the readout, the labelled endpoint and the table carry
 * the exact numbers either way.
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
  // Which month the pointer or the keyboard is on. Null is "none", which
  // is also the server-rendered state — the chart reads the same before
  // hydration as it does with the pointer away.
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) return null;

  const values = points.flatMap((p) => [p.assets, p.liabilities, p.netWorth]);
  // The gridlines set the domain, rather than the domain being padded and
  // the gridlines fitted afterwards. Rounding out to whole steps is what
  // puts headroom above the top line — enough that a 2px stroke at the
  // maximum is not sliced by the edge — and the amount of it is a round
  // number the axis can name.
  const scale = niceScale(Math.min(...values), Math.max(...values));

  const plotLeft = AXIS_GUTTER;
  const plotRight = WIDTH - PAD_RIGHT;
  const stepX = points.length > 1 ? (plotRight - plotLeft) / (points.length - 1) : 0;
  const x = (i: number) =>
    points.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + i * stepX;
  const y = (value: number) =>
    PLOT_HEIGHT - ((value - scale.min) / (scale.max - scale.min)) * (PLOT_HEIGHT - PLOT_TOP);

  const lastIndex = points.length - 1;
  const money = (minor: number) => formatMoney(minor, currency, locale);

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

  /**
   * The column that catches the pointer for month `i`: half a step either
   * side of the point, clipped to the plot.
   *
   * Clipping is not tidiness — an end column that hangs past the plot has
   * its centre outside it, which is where a pointer aimed at "the last
   * month" would be sent.
   */
  const hit = (i: number) => {
    const step = points.length > 1 ? stepX : plotRight - plotLeft;
    const left = Math.max(plotLeft, x(i) - step / 2);
    const right = Math.min(plotRight, x(i) + step / 2);
    return { x: left, width: right - left };
  };

  const shown = active !== null ? points[active] : null;

  return (
    <div>
      {/* Three series, so a legend is mandatory — identity never rests on
          colour matching alone. The text wears ink tokens; the coloured
          dot beside it carries the identity. */}
      <div
        data-testid="net-worth-legend"
        className="text-ink-muted mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs"
      >
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`${s.dot} inline-block size-2.5 rounded-full`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative" onPointerLeave={() => setActive(null)}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block w-full"
          role="group"
          aria-label={tableCaption}
        >
          <ChartGrid
            ticks={scale.ticks}
            y={y}
            left={plotLeft}
            right={plotRight}
            currency={currency}
            locale={locale}
          />

          {/* Under the lines, so the crosshair never cuts across a mark. */}
          {active !== null && (
            <line
              x1={x(active)}
              y1={0}
              x2={x(active)}
              y2={PLOT_HEIGHT}
              className="stroke-rule"
              strokeWidth={1}
            />
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

          {/* Dots only where the reader is looking, plus the endpoint the
              chart is about. A marker on every month of every series is
              36 rings on a phone. */}
          {series.map((s) => {
            const marked = active !== null ? [active, lastIndex] : [lastIndex];
            return [...new Set(marked)].map((i) => (
              <circle
                key={`${s.key}-${i}`}
                cx={x(i)}
                cy={y(s.pick(points[i]))}
                r={4}
                // The ring is the surface colour, so a dot stays legible
                // where two lines cross.
                className={`${s.fill} stroke-card`}
                strokeWidth={2}
              />
            ));
          })}

          {/* No end label on the line. Three series converging at the
              right edge leave nowhere to put one — under the net worth
              point is exactly where the other two lines arrive, and the
              text sat across them. The number is on the page three other
              ways: the figure above this card, the axis beside it, and
              the readout on hover. */}

          {points.map((p, i) => (
            <g key={p.yearMonth}>
              {/* Every other month: twelve labels collide at 360px. */}
              {i % 2 === lastIndex % 2 && (
                <text
                  x={x(i)}
                  y={HEIGHT - 5}
                  textAnchor={i === 0 ? "start" : i === lastIndex ? "end" : "middle"}
                  className="fill-ink-faint text-[9px]"
                >
                  {p.yearMonth.slice(2).replace("-", ".")}
                </text>
              )}
              {/* One column per month, so the pointer only has to be near
                  the right date rather than on a 2px line. */}
              <rect
                x={hit(i).x}
                y={0}
                width={hit(i).width}
                height={HEIGHT}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${p.yearMonth} · ${series.map((s) => `${s.label} ${money(s.pick(p))}`).join(", ")}`}
                data-testid="net-worth-hit"
                className="cursor-pointer outline-none"
                onPointerEnter={() => setActive(i)}
                // Touch reports no hover, so the tap itself has to open
                // the readout.
                onPointerDown={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          ))}
        </svg>

        {shown && (
          <div
            role="status"
            data-testid="net-worth-tooltip"
            className="border-rule bg-card pointer-events-none absolute top-0 z-10 min-w-max rounded-lg border px-2.5 py-2 shadow-lg"
            style={{
              left: `${(x(active!) / WIDTH) * 100}%`,
              // Swung inward at either end rather than off the side of
              // the card.
              transform: `translateX(${
                x(active!) < WIDTH * 0.3 ? "0" : x(active!) > WIDTH * 0.7 ? "-100%" : "-50%"
              })`,
            }}
          >
            <div className="text-ink-faint mb-1 text-[11px] font-semibold">{shown.yearMonth}</div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
              {series.map((s) => (
                <div key={s.key} className="contents">
                  <dt className="text-ink-muted flex items-center gap-1.5">
                    <span className={`${s.dot} size-2 rounded-full`} aria-hidden="true" />
                    {s.label}
                  </dt>
                  <dd
                    className={`tnum text-ink text-right ${
                      s.key === "netWorth" ? "font-bold" : "font-normal"
                    }`}
                  >
                    {money(s.pick(shown))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

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
