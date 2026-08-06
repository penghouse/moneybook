import Link from "next/link";
import { buttonClass, Card } from "./ui";

/**
 * The 이전 달 / 다음 달 bar, shared by the three screens that read a
 * period: the budget, the income statement and the balance sheet.
 *
 * They arrived at their period differently — the budget holds a
 * year-month, the income statement a from/to range, the balance sheet a
 * single as-of date — so each computes its own hrefs. What they share is
 * that stepping a month should not mean opening a date picker, which is
 * the only way any of them could do it before.
 *
 * Plain links, not a form: this is navigation, so it should be
 * middle-clickable, bookmarkable, and back-button-able like any other.
 */
export function PeriodNav({
  prevHref,
  nextHref,
  label,
  prevLabel,
  nextLabel,
}: {
  prevHref: string;
  nextHref: string;
  /** What period is on screen, e.g. "2026-08" or "2026-08-06". */
  label: string;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <Card>
      <div className="flex items-center px-1 py-1">
        <Link href={prevHref} className={buttonClass("ghost")}>
          ← {prevLabel}
        </Link>
        <span className="tnum mx-auto font-semibold">{label}</span>
        <Link href={nextHref} className={buttonClass("ghost")}>
          {nextLabel} →
        </Link>
      </div>
    </Card>
  );
}
