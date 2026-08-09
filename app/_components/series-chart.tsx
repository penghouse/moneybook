"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

const VIEW_WIDTH = 320;
const CHART_HEIGHT = 150;
const LABEL_HEIGHT = 24;
/**
 * Fewer ticks than the bar chart gets: a line's labels are period names
 * ('25.01', five glyphs) rather than a two-character month, so twelve of
 * them across a phone run into each other.
 */
const MAX_TICKS = 6;

/**
 * How many series can be on at once.
 *
 * The cap is the palette's, not a layout preference: four steps clear
 * every colour gate in both themes and a fifth could not be found that
 * clears the normal-vision floor against them. A chart cannot draw a
 * series it has no colour for, so the legend refuses the fifth rather
 * than reusing a colour and telling two stories with one line.
 */
export const MAX_SERIES = 4;

const SERIES_STROKE = [
  "stroke-series-1",
  "stroke-series-2",
  "stroke-series-3",
  "stroke-series-4",
] as const;
const SERIES_FILL = ["bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4"] as const;

export interface SeriesChartSeries {
  key: string;
  name: string;
  /** One value per period, in the same order as `periods`. */
  values: number[];
}

export interface SeriesChartLabels {
  table: string;
  period: string;
  empty: string;
  capped: string;
}

/**
 * Several series over the same periods, with the legend deciding which
 * are drawn.
 *
 * The legend is not decoration here — it is the control. Every 상위 그룹
 * and every 계산식 is offered, and the reader turns on the two or three
 * that answer the question they came with, which is the only way a chart
 * of "whatever this book happens to contain" can stay readable.
 *
 * A series keeps its colour for as long as it is on: turning another one
 * off must not repaint the ones still drawn, or the reader has to
 * re-read the legend after every tap.
 */
export function SeriesChart({
  periods,
  ticks,
  series,
  initial,
  currency,
  locale,
  caption,
  labels,
}: {
  /** Full period names, e.g. '2026-08'. */
  periods: string[];
  /** What the axis shows for each — two or three characters. */
  ticks: string[];
  series: SeriesChartSeries[];
  /** Keys drawn on first render, in colour order. */
  initial: string[];
  currency: string;
  locale: string;
  caption: string;
  labels: SeriesChartLabels;
}) {
  // Which series is in which colour slot. A Map rather than a Set so a
  // survivor's colour cannot move when its neighbour is switched off.
  const [slots, setSlots] = useState<Map<string, number>>(
    () => new Map(initial.slice(0, MAX_SERIES).map((key, i) => [key, i])),
  );
  const [active, setActive] = useState<number | null>(null);

  const toggle = (key: string) => {
    setSlots((current) => {
      const next = new Map(current);
      if (next.delete(key)) return next;
      // The lowest colour nobody is using, so switching one off and
      // another on reuses the freed slot rather than shuffling everyone.
      const taken = new Set(next.values());
      const free = SERIES_STROKE.findIndex((_, i) => !taken.has(i));
      if (free < 0) return current;
      next.set(key, free);
      return next;
    });
  };

  const drawn = series
    .filter((s) => slots.has(s.key))
    .map((s) => ({ ...s, slot: slots.get(s.key)! }));

  const money = (minor: number) => formatMoney(minor, currency, locale);

  const all = drawn.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const plotHeight = CHART_HEIGHT - LABEL_HEIGHT;
  const x = (i: number) =>
    periods.length === 1 ? VIEW_WIDTH / 2 : (i / (periods.length - 1)) * VIEW_WIDTH;
  const y = (value: number) => plotHeight - ((value - min) / span) * plotHeight;

  // Evenly spaced including both ends, rather than "every k-th plus the
  // last" — that rule puts the final two labels side by side whenever
  // the count does not divide, which is most of the time.
  const tickCount = Math.min(MAX_TICKS, periods.length);
  const tickAt = new Set(
    Array.from({ length: tickCount }, (_, k) =>
      tickCount === 1 ? 0 : Math.round((k * (periods.length - 1)) / (tickCount - 1)),
    ),
  );
  const showsTick = (i: number) => tickAt.has(i);
  const zeroInside = min < 0 && max > 0;

  /**
   * The column that catches the pointer for period `i`: half a step
   * either side of the point, clipped to the drawing.
   *
   * Clipping is not tidiness — an end column that hangs past the viewBox
   * has its centre outside the svg, which is where a pointer aimed at
   * "the last month" would be sent.
   */
  const hit = (i: number) => {
    const step = periods.length > 1 ? VIEW_WIDTH / (periods.length - 1) : VIEW_WIDTH;
    const left = Math.max(0, x(i) - step / 2);
    const right = Math.min(VIEW_WIDTH, x(i) + step / 2);
    return { x: left, width: right - left };
  };

  return (
    <div>
      <div className="relative mx-auto w-full max-w-[480px]" onPointerLeave={() => setActive(null)}>
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${CHART_HEIGHT}`}
          className="block w-full"
          role="group"
          aria-label={caption}
        >
          {zeroInside && (
            <line
              x1={0}
              y1={y(0)}
              x2={VIEW_WIDTH}
              y2={y(0)}
              className="stroke-rule"
              strokeWidth={1}
            />
          )}

          {drawn.map((s) => (
            <polyline
              key={s.key}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={SERIES_STROKE[s.slot]}
            />
          ))}

          {periods.map((period, i) => (
            <g key={period}>
              {showsTick(i) && (
                <text
                  x={x(i)}
                  y={CHART_HEIGHT - 4}
                  textAnchor={i === 0 ? "start" : i === periods.length - 1 ? "end" : "middle"}
                  className="fill-ink-faint text-[9px]"
                >
                  {ticks[i]}
                </text>
              )}
              {active === i &&
                drawn.map((s) => (
                  <circle
                    key={s.key}
                    cx={x(i)}
                    cy={y(s.values[i])}
                    r={3}
                    className={`${SERIES_STROKE[s.slot]} fill-card`}
                    strokeWidth={2}
                  />
                ))}
              {/* One column per period, so the pointer only has to be
                  near the right date rather than on a 2px line. */}
              <rect
                x={hit(i).x}
                y={0}
                width={hit(i).width}
                height={CHART_HEIGHT}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${period}: ${drawn.map((s) => `${s.name} ${money(s.values[i])}`).join(", ")}`}
                data-testid="series-hit"
                className="cursor-pointer outline-none"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          ))}
        </svg>

        {active !== null && drawn.length > 0 && (
          <div
            role="status"
            data-testid="series-tooltip"
            className="border-rule bg-card pointer-events-none absolute top-0 z-10 min-w-max rounded-lg border px-2.5 py-2 shadow-lg"
            style={{
              left: `${(x(active) / VIEW_WIDTH) * 100}%`,
              transform: `translateX(${
                x(active) < VIEW_WIDTH * 0.25
                  ? "0"
                  : x(active) > VIEW_WIDTH * 0.75
                    ? "-100%"
                    : "-50%"
              })`,
            }}
          >
            <div className="text-ink-faint mb-1 text-[11px] font-semibold">{periods[active]}</div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
              {drawn.map((s) => (
                <div key={s.key} className="contents">
                  <dt className="text-ink-muted flex items-center gap-1.5">
                    {/* A short stroke of the series colour, not a filled
                        box: at this density a box is data-weight ink
                        doing a label's job. */}
                    <span className={`h-0.5 w-3 rounded-full ${SERIES_FILL[s.slot]}`} />
                    {s.name}
                  </dt>
                  <dd className="tnum text-ink text-right font-semibold">
                    {money(s.values[active])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {/* The legend, which is also the switch. Every series is named
          beside its colour, so identity never rests on colour alone. */}
      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="series-legend">
        {series.map((s) => {
          const slot = slots.get(s.key);
          const on = slot !== undefined;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.key)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs ${
                on
                  ? "border-rule bg-sunken text-ink font-semibold"
                  : "border-rule-soft text-ink-faint"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-0.5 w-3.5 rounded-full ${on ? SERIES_FILL[slot] : "bg-rule"}`}
              />
              {s.name}
            </button>
          );
        })}
      </div>
      {drawn.length === 0 ? (
        <p className="text-ink-faint mt-1.5 text-xs">{labels.empty}</p>
      ) : (
        drawn.length === MAX_SERIES && (
          <p className="text-ink-faint mt-1.5 text-xs">{labels.capped}</p>
        )
      )}

      <details className="mt-1">
        <summary className="text-ink-faint flex min-h-11 cursor-pointer items-center text-xs">
          {labels.table}
        </summary>
        {/* Contrast against the card is above 3:1 for every step, but two
            of the dark ones sit in the CVD warn band — so the numbers are
            reachable without reading a colour at all. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-faint text-left text-xs">
                <th scope="col" className="py-2 font-normal">
                  {labels.period}
                </th>
                {drawn.map((s) => (
                  <th key={s.key} scope="col" className="py-2 text-right font-normal">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period, i) => (
                <tr key={period} className="border-rule-soft border-t">
                  <td className="tnum py-2">{period}</td>
                  {drawn.map((s) => (
                    <td key={s.key} className="tnum py-2 text-right">
                      {money(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
