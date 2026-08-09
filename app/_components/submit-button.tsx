"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "./ui";

/**
 * A submit button that says when it is working.
 *
 * Every plain `<form action={serverAction}>` in this app used a bare
 * `<button type="submit">`, so between the click and the re-render there
 * was no signal at all — no disabled state, no label change, nothing.
 * Against a local SQLite file that gap is imperceptible; against a hosted
 * database it is long enough to wonder whether the click registered, and
 * long enough to click again. On 「삭제」 or 「보관」 the second click is
 * not harmless.
 *
 * `useFormStatus` reads the pending state of the form this button is
 * inside, which is why it must be its own client component: the hook only
 * reports on a form rendered by an *ancestor*, so a button that read the
 * status itself would always see `false`.
 */
export function SubmitButton({
  children,
  pendingLabel,
  label,
  variant = "secondary",
  full = false,
  disabled = false,
  className = "",
}: {
  children: React.ReactNode;
  /** Shown while the action runs. Falls back to the idle label. */
  pendingLabel?: string;
  /**
   * The accessible name, for buttons whose visible content is a glyph.
   * An arrow is not a word in any language, so a row of them needs this
   * to be readable — and it is what the tests address them by.
   */
  label?: string;
  variant?: ButtonVariant;
  full?: boolean;
  /** For buttons that are unavailable for their own reasons, e.g. "move up" at the top. */
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      // The label is swapped rather than replaced by a spinner: this is
      // one line of text either way, so the row cannot reflow and shift
      // the buttons beside it out from under a finger mid-tap.
      aria-busy={pending}
      aria-label={label}
      className={`${buttonClass(variant, full)} ${className}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
