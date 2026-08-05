import { formatMoney } from "@/lib/money";

export interface CompositionSlice {
  id: string;
  name: string;
  amount: number;
}

/**
 * Where the money is sitting, biggest first.
 *
 * Every bar wears the same hue on purpose. These are nominal categories
 * — account names — and colouring them individually would spend the
 * identity channel re-encoding what the bar length already says, while
 * pushing past the point where any palette stays distinguishable. Length
 * carries the magnitude; the name sits beside it.
 *
 * Built from ordinary elements rather than SVG: a horizontal bar chart
 * is a list of rows, and as HTML the labels wrap and truncate the way
 * every other list on the page does.
 */
export function CompositionChart({
  slices,
  currency,
  locale,
  shareLabel,
}: {
  slices: CompositionSlice[];
  currency: string;
  locale: string;
  shareLabel: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  if (slices.length === 0 || total <= 0) return null;

  return (
    <ul aria-label={shareLabel}>
      {slices.map((slice) => {
        const percent = (slice.amount / total) * 100;
        return (
          <li key={slice.id} className="not-first:border-rule-soft px-4 py-3 not-first:border-t">
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">{slice.name}</span>
              <span className="tnum shrink-0 text-sm font-semibold">
                {formatMoney(slice.amount, currency, locale)}
              </span>
              <span className="tnum text-ink-faint w-11 shrink-0 text-right text-xs">
                {percent.toFixed(1)}%
              </span>
            </div>
            <div className="bg-rule-soft mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-series-1 h-full rounded-full"
                style={{ width: `${Math.max(percent, 1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
