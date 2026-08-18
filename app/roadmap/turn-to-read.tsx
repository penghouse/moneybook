"use client";

import { useState, type ReactNode } from "react";
import { buttonClass } from "../_components/ui";

/**
 * 「가로로 보기」 — the reader's own request for the screen's long side.
 *
 * Forty years of seven columns has no upright arrangement on a phone,
 * and nothing on the web can ask the device to turn. So this asks the
 * reader instead: pressing it lays the table on its side (see
 * .rotate-to-read in globals.css), and turning the phone anticlockwise
 * puts it upright.
 *
 * State, not a media query, because a table that turned itself over on
 * its own would be startling every time the page was opened — the reader
 * should be the one who decided to tilt their head.
 *
 * The CSS behind it is still gated on a small screen held upright, so
 * turning the phone far enough for the browser to call it landscape
 * drops the transform on its own and the table simply lays out wide.
 * Nothing has to be pressed a second time.
 */
export function TurnToRead({
  labels,
  children,
}: {
  labels: { turn: string; unturn: string; hint: string };
  children: ReactNode;
}) {
  const [turned, setTurned] = useState(false);

  return (
    <>
      {/* Phones only. A desktop window already has the long side. */}
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setTurned((on) => !on)}
          aria-pressed={turned}
          className={buttonClass("secondary")}
        >
          {turned ? labels.unturn : labels.turn}
        </button>
        {turned && <span className="text-ink-faint text-xs">{labels.hint}</span>}
      </div>

      <div className="rotate-to-read" data-turned={turned}>
        {children}
      </div>
    </>
  );
}
