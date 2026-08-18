"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass, controlClass, Label } from "./ui";

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

/**
 * The same idea for a screen whose period is a range rather than a key.
 *
 * The income chart used to carry a 시작 / 끝 / 조회 form in its header —
 * three controls permanently on screen for a question asked once in a
 * while, and the only one of the period screens that answered "which
 * period" with a form instead of with the bar. The arrows and the
 * 월간/연간 switch were already in the bar; the range now is too.
 *
 * Two dates will not fit between the arrows at 393px the way a single
 * month does, so this one opens a modal rather than swapping itself out
 * in place. `<dialog showModal>` for the same reasons the row editor
 * uses it: Escape, focus trapping and the top layer, none of which a div
 * gets right for free.
 */
export function RangeJump({
  value,
  from,
  to,
  hrefTemplate,
  label,
  fromLabel,
  toLabel,
  confirmLabel,
  closeLabel,
}: {
  /** The range as it reads on the bar, e.g. '2025-09-01 ~ 2026-08-31'. */
  value: string;
  from: string;
  to: string;
  /** '{from}' and '{to}' are replaced with the picked dates. */
  hrefTemplate: string;
  /** Accessible name — the visible text is a bare range and says nothing. */
  label: string;
  fromLabel: string;
  toLabel: string;
  confirmLabel: string;
  closeLabel: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [nextFrom, setNextFrom] = useState(from);
  const [nextTo, setNextTo] = useState(to);

  const go = () => {
    dialog.current?.close();
    if (nextFrom === from && nextTo === to) return;
    // Picked backwards is a slip, not a range: the reader means the two
    // dates they chose, in the order that makes a window.
    const [a, b] = nextFrom > nextTo ? [nextTo, nextFrom] : [nextFrom, nextTo];
    router.push(hrefTemplate.replace("{from}", a).replace("{to}", b));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Reopened after a step, the fields should say where the
          // reader is now — not where they were the last time they
          // opened this.
          setNextFrom(from);
          setNextTo(to);
          dialog.current?.showModal();
        }}
        aria-label={label}
        data-testid="range-jump"
        className="tnum hover:text-accent mx-auto min-h-12 px-3 text-sm font-semibold underline decoration-dotted underline-offset-4"
      >
        {value}
      </button>

      <dialog
        ref={dialog}
        aria-label={label}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="bg-card rounded-card text-ink m-auto w-[min(24rem,calc(100vw-1.5rem))] p-0 backdrop:bg-black/50"
      >
        <div className="border-rule-soft flex min-h-12 items-center gap-2 border-b px-4">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{label}</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={closeLabel}
            className="text-ink-faint hover:text-ink -mr-2 grid h-11 w-11 shrink-0 place-items-center text-xl"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div>
            <Label htmlFor="range-jump-from">{fromLabel}</Label>
            <input
              id="range-jump-from"
              type="date"
              value={nextFrom}
              onChange={(e) => setNextFrom(e.target.value)}
              data-testid="range-jump-from"
              className={`${controlClass} tnum`}
            />
          </div>
          <div>
            <Label htmlFor="range-jump-to">{toLabel}</Label>
            <input
              id="range-jump-to"
              type="date"
              value={nextTo}
              onChange={(e) => setNextTo(e.target.value)}
              data-testid="range-jump-to"
              className={`${controlClass} tnum`}
            />
          </div>
          <button
            type="button"
            onClick={go}
            data-testid="range-jump-confirm"
            className={buttonClass("primary", true)}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
