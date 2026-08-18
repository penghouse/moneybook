"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The period label, made into a way of getting somewhere.
 *
 * The arrows either side of it step one month at a time, which is right
 * for "what did last month look like" and useless for "what did I budget
 * in January". Eight taps to reach it, and eight more to come back.
 *
 * So the label opens the browser's own month picker. Native rather than
 * a hand-rolled grid: `<input type="month">` already knows what a month
 * is in the reader's locale, is reachable by keyboard, and on a phone
 * gets the platform's full-size wheel — none of which a div of buttons
 * would match.
 *
 * The input is mounted only once asked for, because an always-present
 * month field would sit between the two arrows and make the bar read as
 * a form to fill in rather than a place you already are.
 */
export function PeriodJump({
  value,
  unit,
  hrefPrefix,
  label,
}: {
  /** '2026-08' when the unit is a month, '2026' when it is a year. */
  value: string;
  unit: "month" | "year";
  /** The picked value is appended to this, e.g. '/budget?period='. */
  hrefPrefix: string;
  /** Accessible name — the visible text is a bare date and says nothing. */
  label: string;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picking) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Chrome and Safari open the native picker on request; where they do
    // not, this throws and the field is still a perfectly good typed
    // input, which is why nothing is done with the failure.
    try {
      el.showPicker();
    } catch {
      // Not supported here — typing works.
    }
  }, [picking]);

  const go = (next: string) => {
    if (!next || next === value) {
      setPicking(false);
      return;
    }
    setPicking(false);
    router.push(hrefPrefix + next);
  };

  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        aria-label={label}
        data-testid="period-jump"
        className="tnum hover:text-accent mx-auto min-h-12 px-3 font-semibold underline decoration-dotted underline-offset-4"
      >
        {value}
      </button>
    );
  }

  const isMonth = unit === "month";
  return (
    <input
      ref={ref}
      type={isMonth ? "month" : "number"}
      defaultValue={value}
      aria-label={label}
      data-testid="period-jump-input"
      // A month arrives whole from the picker, so it can navigate the
      // moment it changes. A year is typed a digit at a time — '2' then
      // '20' are both valid numbers and neither is a year anyone meant —
      // so it waits to be committed.
      {...(isMonth
        ? { onChange: (e: React.ChangeEvent<HTMLInputElement>) => go(e.target.value) }
        : { min: 1000, max: 9999, step: 1 })}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          go(e.currentTarget.value);
        }
        if (e.key === "Escape") setPicking(false);
      }}
      onBlur={(e) =>
        isMonth || !/^\d{4}$/.test(e.target.value) ? setPicking(false) : go(e.target.value)
      }
      className="bg-sunken rounded-control tnum mx-auto min-h-12 w-40 px-2 text-center font-semibold"
    />
  );
}
