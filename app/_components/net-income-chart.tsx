"use client";

import { useState } from "react";
import { niceScale } from "@/lib/chart-scale";
import { formatMoney } from "@/lib/money";
import { AXIS_GUTTER, ChartGrid } from "./chart-axis";

/**
 * The viewBox is a fixed box that the bars divide up, rather than a
 * width that grows with them.
 *
 * Growing it meant the drawing's aspect ratio was set by how many
 * periods were asked for: twelve months scaled to 3× on a laptop, with
 * 9px ticks rendering at 29px, while a five-year range would have
 * shrunk them to nothing. A constant box keeps every range the same
 * shape and the type the same size — the bars get thinner, which is the
 * honest thing for a range to do.
 */
const VIEW_WIDTH = 320;
const CHART_HEIGHT = 150;
const LABEL_HEIGHT = 24;
/** Enough ticks to read the axis by; more than this and they collide. */
const MAX_TICKS = 12;
/**
 * Headroom above the top gridline, for that gridline's own label. SVG
 * puts a text baseline at y, so a label on a rule at y=0 has its whole
 * ascender outside the viewBox and renders sliced in half.
 */
const PLOT_TOP = 9;

export interface NetIncomeChartPoint {
  /** The period's full name — '2026-08' or '2026'. Read out and tabulated. */
  label: string;
  /** The axis tick, which has room for two or three characters at most. */
  tick: string;
  income: number;
  expense: number;
  net: number;
}

export interface NetIncomeChartLabels {
  income: string;
  expense: string;
  net: string;
  /** The disclosure's own label — repeating the section heading here
   *  reads as a stray caption rather than a control. */
  table: string;
  period: string;
}

// Rounded corners only at the data end, square at the zero baseline —
// growing up (positive) rounds the top, growing down (negative) rounds
// the bottom. A plain <rect rx> would round all four corners, which
// reads wrong where a bar meets the baseline.
function barPath(x: number, w: number, baseline: number, value: number, pxPerUnit: number): string {
  const h = Math.abs(value) * pxPerUnit;
  const r = Math.min(4, w / 2, h / 2);
  if (value >= 0) {
    const top = baseline - h;
    return `M${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${baseline} L${x},${baseline} Z`;
  }
  const bottom = baseline + h;
  return `M${x},${baseline} L${x + w},${baseline} L${x + w},${bottom - r} Q${x + w},${bottom} ${x + w - r},${bottom} L${x + r},${bottom} Q${x},${bottom} ${x},${bottom - r} Z`;
}

export function NetIncomeChart({
  points,
  currency,
  locale,
  tableCaption,
  labels,
}: {
  points: NetIncomeChartPoint[];
  currency: string;
  locale: string;
  tableCaption: string;
  labels: NetIncomeChartLabels;
}) {
  // Which bar the pointer or the keyboard is on. Null is "none", which
  // is also the server-rendered state — the chart reads the same before
  // hydration as it does with the pointer away.
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) return null;

  // Zero is always on the axis — a bar chart of gains and losses has to
  // show which side of nothing each month is on — but the axis only
  // reaches as far the other way as the data does. Reserving a
  // symmetric half for deficits, as this did, spent half the plot on
  // empty space in a year that never had one, and halved every bar to
  // pay for it.
  const nets = points.map((p) => p.net);
  const scale = niceScale(Math.min(0, ...nets), Math.max(0, ...nets));
  const plotBottom = CHART_HEIGHT - LABEL_HEIGHT;
  const pxPerUnit = (plotBottom - PLOT_TOP) / (scale.max - scale.min);
  const y = (value: number) => plotBottom - (value - scale.min) * pxPerUnit;
  const baseline = y(0);

  // Each period gets an equal slice of the plot; the gap is a quarter of
  // it, capped, so twelve bars breathe and sixty still have a hairline
  // between them rather than reading as one block.
  const plotLeft = AXIS_GUTTER;
  const plotWidth = VIEW_WIDTH - plotLeft;
  const slot = plotWidth / points.length;
  const gap = Math.min(6, slot * 0.25);
  // Capped: a five-bar range would otherwise draw 50px slabs, which read
  // as a different chart from the twelve-bar one beside it.
  const barWidth = Math.min(24, slot - gap);
  const leftOf = (i: number) => plotLeft + i * slot + (slot - barWidth) / 2;

  const extremeIndex = points.reduce(
    (best, p, i) => (Math.abs(p.net) > Math.abs(points[best].net) ? i : best),
    0,
  );
  const lastIndex = points.length - 1;
  // Every tick when they fit, every k-th when they do not — the first
  // and the last always, since those are the ends of the range.
  const tickStep = Math.ceil(points.length / MAX_TICKS);
  const showsTick = (i: number) => i === 0 || i === lastIndex || i % tickStep === 0;

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const shown = active !== null ? points[active] : null;
  // Positioned in percentages of the viewBox, which is exactly the
  // percentages of the rendered box: the svg scales as one piece, so no
  // measuring and no resize listener.
  const centreOf = (i: number) => ((leftOf(i) + barWidth / 2) / VIEW_WIDTH) * 100;
  const topOf = (p: NetIncomeChartPoint) =>
    ((p.net >= 0 ? baseline - p.net * pxPerUnit : baseline) / CHART_HEIGHT) * 100;
  // A tall bar leaves no room above it, and the card clips what hangs
  // out — so the readout flips under the bar's top edge instead.
  const tipAbove = shown !== null && topOf(shown) > 45;

  return (
    <div>
      {/* Capped rather than filled. An svg with a viewBox scales as one
          piece, so a full-width card on a laptop would render the 9px
          ticks at 29px and the bars three times too tall. The cap also
          keeps the drawing exactly the size of this box, which is what
          lets the readout be placed in percentages without measuring. */}
      <div className="relative mx-auto w-full max-w-[480px]" onPointerLeave={() => setActive(null)}>
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${CHART_HEIGHT}`}
          className="block w-full"
          role="group"
          aria-label={tableCaption}
        >
          <ChartGrid
            ticks={scale.ticks}
            y={y}
            left={plotLeft}
            right={VIEW_WIDTH}
            currency={currency}
            locale={locale}
          />
          {points.map((p, i) => {
            const x = leftOf(i);
            const label = `${p.label}: ${money(p.net)}`;
            return (
              <g key={p.label}>
                <path
                  d={barPath(x, barWidth, baseline, p.net, pxPerUnit)}
                  className={`${p.net >= 0 ? "fill-positive" : "fill-negative"} ${
                    // The hovered bar keeps its colour and the rest step
                    // back: dimming the others cannot be mistaken for the
                    // bar having a different value.
                    active !== null && active !== i ? "opacity-40" : ""
                  }`}
                  role="img"
                  aria-label={label}
                />
                {showsTick(i) && (
                  <text
                    x={x + barWidth / 2}
                    y={CHART_HEIGHT - 4}
                    textAnchor="middle"
                    className="fill-ink-faint text-[9px]"
                  >
                    {p.tick}
                  </text>
                )}
                {(i === extremeIndex || i === lastIndex) && active === null && (
                  // A centred label on the first or last bar hangs off the
                  // side of the viewBox and gets clipped — the most recent
                  // period is always labelled, so that is not a rare case.
                  // Hidden while a bar is hovered, where the readout is
                  // saying the same thing more precisely.
                  <text
                    x={i === 0 ? x : i === lastIndex ? x + barWidth : x + barWidth / 2}
                    y={
                      p.net >= 0
                        ? baseline - Math.abs(p.net) * pxPerUnit - 4
                        : baseline + Math.abs(p.net) * pxPerUnit + 12
                    }
                    textAnchor={i === 0 ? "start" : i === lastIndex ? "end" : "middle"}
                    className="fill-ink-muted text-[10px] font-semibold"
                  >
                    {money(p.net)}
                  </text>
                )}
                {/* The hit target is the whole slot, gap included — a ₩0
                    month is a 0px bar, and aiming at painted pixels would
                    make it unreachable. */}
                <rect
                  x={plotLeft + i * slot}
                  y={0}
                  width={slot}
                  height={CHART_HEIGHT}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${label} · ${labels.income} ${money(p.income)} · ${labels.expense} ${money(p.expense)}`}
                  data-testid="chart-bar-hit"
                  className="cursor-pointer outline-none"
                  onPointerEnter={() => setActive(i)}
                  // Touch reports no hover, so the tap itself has to open
                  // the readout.
                  onPointerDown={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>

        {shown && (
          <div
            role="status"
            data-testid="chart-tooltip"
            className="border-rule bg-card pointer-events-none absolute z-10 min-w-max rounded-lg border px-2.5 py-2 shadow-lg"
            style={{
              left: `${centreOf(active!)}%`,
              top: `${topOf(shown)}%`,
              // Above the bar where there is room, under its top edge
              // where there is not — and swung inward at either end
              // rather than off the side of the card.
              transform: `translate(${
                centreOf(active!) < 25 ? "0" : centreOf(active!) > 75 ? "-100%" : "-50%"
              }, ${tipAbove ? "calc(-100% - 6px)" : "6px"})`,
            }}
          >
            <div className="text-ink-faint mb-1 text-[11px] font-semibold">{shown.label}</div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-ink-muted">{labels.net}</dt>
              <dd
                className={`tnum text-right font-bold ${
                  shown.net >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {money(shown.net)}
              </dd>
              <dt className="text-ink-faint">{labels.income}</dt>
              <dd className="tnum text-ink-muted text-right">{money(shown.income)}</dd>
              <dt className="text-ink-faint">{labels.expense}</dt>
              <dd className="tnum text-ink-muted text-right">{money(shown.expense)}</dd>
            </dl>
          </div>
        )}
      </div>

      <details className="mt-1">
        <summary className="text-ink-faint flex min-h-11 cursor-pointer items-center text-xs">
          {labels.table}
        </summary>
        {/* Every number the readout can show, reachable without a
            pointer — which is what lets the chart itself stay a single
            series instead of three. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-faint text-left text-xs">
                <th scope="col" className="py-2 font-normal">
                  {labels.period}
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  {labels.income}
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  {labels.expense}
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  {labels.net}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label} className="border-rule-soft border-t">
                  <td className="tnum py-2">{p.label}</td>
                  <td className="tnum py-2 text-right">{money(p.income)}</td>
                  <td className="tnum py-2 text-right">{money(p.expense)}</td>
                  <td className="tnum py-2 text-right font-semibold">{money(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
