import { foldComposition, type Slice } from "@/lib/composition";
import { formatMoney } from "@/lib/money";

export type CompositionSlice = Slice;

/**
 * What the folded tail is called in the list, and the id it goes under.
 * A NUL cannot occur in an account name or a 적요, so this cannot
 * collide with a real row's key.
 */
const REST_ID = "\u0000rest";

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
 *
 * Only the big ones get a row of their own; the tail is summed into one.
 * A card whose height follows how many 적요 a month happened to contain
 * pushes the list it sits above off the screen, and the small end is
 * exactly the part a composition cannot answer anything with.
 */
export function CompositionChart({
  slices,
  currency,
  locale,
  shareLabel,
  restLabel,
}: {
  slices: CompositionSlice[];
  currency: string;
  locale: string;
  shareLabel: string;
  /** Names the folded tail; '{n}' is how many rows went into it. */
  restLabel: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  if (slices.length === 0 || total <= 0) return null;

  const rows = foldComposition(slices, REST_ID, (count) => restLabel.replace("{n}", String(count)));

  return (
    <ul aria-label={shareLabel}>
      {rows.map((slice) => {
        const percent = (slice.amount / total) * 100;
        return (
          <li key={slice.id} className="not-first:border-rule-soft px-4 py-3 not-first:border-t">
            <div className="flex items-baseline gap-3">
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  slice.id === REST_ID ? "text-ink-faint" : ""
                }`}
              >
                {slice.name}
              </span>
              <span className="tnum shrink-0 text-sm font-semibold">
                {formatMoney(slice.amount, currency, locale)}
              </span>
              <span className="tnum text-ink-faint w-11 shrink-0 text-right text-xs">
                {percent.toFixed(1)}%
              </span>
            </div>
            <div className="bg-rule-soft mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full ${slice.id === REST_ID ? "bg-rule" : "bg-series-1"}`}
                style={{ width: `${Math.max(percent, 1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
