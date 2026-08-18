"use client";

import { useState, type ReactNode } from "react";
import { buttonClass } from "./ui";

/**
 * What a transaction's dialog shows: the record as it stands, or a copy
 * of it waiting to be saved as a new one.
 *
 * 복제 used to be a link. Pressing it navigated to `/?duplicate=<id>`,
 * which re-ran every query the page makes and re-rendered the whole
 * screen just to put the same values — already on screen, already in
 * this dialog — into a form at the top of the page. A round trip to copy
 * something the browser was already holding, and the form landed
 * somewhere other than where the press happened.
 *
 * Both forms are the same component over the same values; the only
 * difference is whether the transaction's id travels with them, which is
 * what decides between updating and creating. So the choice is state,
 * and switching is a render.
 *
 * 복제 and 삭제 ride above the form rather than below it. They act on
 * the *record*; everything below belongs to the form, which has to end
 * in 저장 — the button a reader looks for at the bottom of anything they
 * have been filling in. Above also means a split's four legs cannot push
 * them off the screen.
 */
export function RowEditor({
  edit,
  copy,
  notice,
  copyLabel,
  backLabel,
  children,
}: {
  /** The form that updates this transaction. */
  edit: ReactNode;
  /** The same values, saved as a new transaction. */
  copy: ReactNode;
  notice: string;
  copyLabel: string;
  backLabel: string;
  /** 삭제 — anything that belongs to the record rather than the form. */
  children: ReactNode;
}) {
  const [copying, setCopying] = useState(false);

  return (
    <div className="space-y-3">
      {copying ? (
        <div className="bg-accent-soft rounded-control flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pr-1 pl-3">
          <span className="text-ink-muted min-w-0 flex-1 text-sm">{notice}</span>
          <button
            type="button"
            onClick={() => setCopying(false)}
            className={buttonClass("ghost")}
            data-testid="duplicate-cancel"
          >
            ← {backLabel}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCopying(true)}
            className={buttonClass("secondary")}
            data-testid="duplicate"
          >
            {copyLabel}
          </button>
          {children}
        </div>
      )}

      {/* Keyed apart on purpose. Both are an EntryForm in the same
          position, so React would reconcile them as one element and the
          form would carry its useState values — date, 적요, every leg —
          straight across the switch, ignoring the `initial` it was just
          handed. Distinct keys make each mode start from its own. */}
      {copying ? <div key="copy">{copy}</div> : <div key="edit">{edit}</div>}
    </div>
  );
}
