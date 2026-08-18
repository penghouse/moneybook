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
export interface PeriodUnitOption {
  /** "월" / "년". */
  label: string;
  href: string;
  active: boolean;
}

/**
 * The 월간/연간 switch on its own, for a screen that has no arrows to
 * hang it under — the income charts pick their period with a date range
 * instead, but the control that says what a bar *means* should be the
 * same control everywhere.
 */
export function PeriodUnits({
  units,
  className = "",
}: {
  units: readonly PeriodUnitOption[];
  className?: string;
}) {
  return (
    <div role="group" className={`flex gap-1 px-1 py-1 ${className}`} data-testid="period-units">
      {units.map((unit) => (
        <Link
          key={unit.label}
          href={unit.href}
          aria-current={unit.active ? "page" : undefined}
          className={`${buttonClass(unit.active ? "primary" : "ghost")} flex-1 justify-center`}
        >
          {unit.label}
        </Link>
      ))}
    </div>
  );
}

export function PeriodNav({
  prevHref,
  nextHref,
  label,
  prevLabel,
  nextLabel,
  units,
}: {
  prevHref: string;
  nextHref: string;
  /** What period is on screen, e.g. "2026-08" or "2026-08-06". */
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** 월/년 switch, omitted on screens that only step one unit. */
  units?: readonly PeriodUnitOption[];
}) {
  return (
    <Card>
      <div className="flex items-center px-1 py-1">
        <Link href={prevHref} className={buttonClass("nav")}>
          ← {prevLabel}
        </Link>
        <span className="tnum mx-auto font-semibold">{label}</span>
        <Link href={nextHref} className={buttonClass("nav")}>
          {nextLabel} →
        </Link>
      </div>
      {units && (
        // A second row rather than squeezed alongside the arrows: at
        // 360px the arrows already fill the width, and a control that
        // changes what the numbers *mean* should not be the one that
        // gets truncated.
        <PeriodUnits units={units} className="border-rule-soft border-t" />
      )}
    </Card>
  );
}
