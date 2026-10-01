"use client";

import { useActionState, useState, type ReactNode } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { SubmitButton } from "../_components/submit-button";
import { buttonClass, controlClass } from "../_components/ui";

/**
 * The amount box for one account's budget — folded away once there is a
 * budget to fold.
 *
 * Every row used to carry an input and a filled 저장 button whether or
 * not anything needed setting, so a page of twenty settled budgets was
 * twenty primary buttons shouting for a press that was not wanted. A row
 * that is already set now shows its figures and a quiet 수정; the box
 * comes back for that row alone.
 *
 * Rows with no budget keep the box open, because that is the only way to
 * give them one and hiding it behind a press would bury the action on
 * exactly the rows that still need it.
 */
export function BudgetField({
  action,
  accountId,
  period,
  amountMajor,
  note,
  labels,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  accountId: string;
  period: string;
  /** Undefined when this account has no budget for the period on screen. */
  amountMajor?: number;
  /** What the reader wrote about this budget, if anything. */
  note?: string | null;
  labels: Record<
    "field" | "edit" | "cancel" | "save" | "saving" | "noBudget" | "note" | "notePlaceholder",
    string
  >;
  /** The figures the row shows when it is folded — 설정 예산 and 잔여. */
  children?: ReactNode;
}) {
  const isSet = amountMajor !== undefined;
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  const [, dispatch] = useActionState(async (_state: null, formData: FormData) => {
    try {
      await action(formData);
    } catch (error) {
      // A rejected reducer never settles its transition, which would
      // leave 저장 on 저장 중… for good. redirect() and notFound()
      // travel as errors and belong to the framework.
      unstable_rethrow(error);
      router.refresh();
    }
    setEditing(false);
    return null;
  }, null);

  if (isSet && !editing) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {/* Quiet on purpose: this is the row's least-wanted action, and
            a filled button here is what made the page shout. The 48px
            target stays — the negative margin takes it out of the line's
            height rather than out of the finger's way. */}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-ink-faint hover:text-ink -my-2 -mr-2 grid min-h-12 shrink-0 place-items-center px-2 text-xs underline underline-offset-4"
        >
          {labels.edit}
        </button>
      </div>
    );
  }

  return (
    <>
      {children}
      <form action={dispatch} className="mt-2 space-y-2">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="period" value={period} />
        <div className="flex gap-2">
          <input
            type="number"
            name="amount"
            step="any"
            min="0"
            inputMode="decimal"
            aria-label={labels.field}
            placeholder={isSet ? undefined : labels.noBudget}
            defaultValue={amountMajor}
            className={`${controlClass} tnum min-w-0 flex-1 text-right`}
          />
          <SubmitButton variant="primary" pendingLabel={labels.saving}>
            {labels.save}
          </SubmitButton>
          {isSet && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={buttonClass("ghost")}
            >
              {labels.cancel}
            </button>
          )}
        </div>
        {/* Only once there is a budget to write about — and so only
            behind 수정, which is where the figures are already being
            reconsidered. A box on every unset row is the same noise the
            filled 저장 buttons were: twenty empty fields asking to be
            filled, on the rows that have least to say.

            In the same form and saved by the same press, because the
            note is about the figure above it: 「외식 줄이기로 5만 내림」.
            Emptying it clears the note, which is why it has no delete of
            its own. */}
        {isSet && (
          <input
            type="text"
            name="note"
            aria-label={labels.note}
            placeholder={labels.notePlaceholder}
            defaultValue={note ?? ""}
            maxLength={200}
            className={`${controlClass} w-full text-sm`}
          />
        )}
      </form>
    </>
  );
}
