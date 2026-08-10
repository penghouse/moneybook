"use client";

import { useState } from "react";
import { Label, controlClass } from "../_components/ui";

export interface CategoryFieldLabels {
  category: string;
  uncategorized: string;
  addNew: string;
  backToList: string;
  placeholder: string;
}

/**
 * The 상위 그룹 field: a real menu of the 상위 그룹 this 분류 already
 * has, with a last entry that opens a box for a new one.
 *
 * It was an `<input list>` — a free-text box with a suggestion popup.
 * Two problems, and the second is why the first kept coming back. It
 * does not look like a menu, so there was no reason to expect it to
 * behave like one. And the popup is browser UI rather than DOM: Chromium
 * binds it when the element is created and goes on showing that list
 * after `list` changes, so switching 분류 left the previous 분류's
 * 상위 그룹 on offer with nothing in the page to show for it — not
 * assertable in a test, and pickable, which is how an asset account ends
 * up filed under an expense's 상위 그룹.
 *
 * A `<select>` has none of that: the options are elements, so what is on
 * offer is exactly what was rendered, and a test can read it.
 */
export function CategoryField({
  categories,
  defaultValue = "",
  labels,
}: {
  /** The 상위 그룹 already in use in this 분류. */
  categories: readonly string[];
  defaultValue?: string;
  labels: CategoryFieldLabels;
}) {
  // An account already filed under a 상위 그룹 that no longer appears
  // anywhere else — the last of its kind, or one just renamed — still has
  // to show its own value rather than silently reading as 미분류.
  const known = defaultValue === "" || categories.includes(defaultValue);
  const [typing, setTyping] = useState(!known);
  const [choice, setChoice] = useState(known ? defaultValue : "");

  return (
    <div className="min-w-0">
      <Label>{labels.category}</Label>
      {typing ? (
        <div className="flex gap-1">
          <input
            type="text"
            name="category"
            autoFocus
            defaultValue={defaultValue}
            placeholder={labels.placeholder}
            className={controlClass}
          />
          {/* Only offered when there is a list to go back to. */}
          {categories.length > 0 && (
            <button
              type="button"
              onClick={() => setTyping(false)}
              className="text-ink-faint shrink-0 px-2 text-xs whitespace-nowrap"
            >
              {labels.backToList}
            </button>
          )}
        </div>
      ) : (
        <select
          name="category"
          value={choice}
          onChange={(event) => {
            // Recognised by position, not by a sentinel value. A magic
            // string has to be one no 상위 그룹 could ever be called, and
            // the last option is simply the last option.
            const last = event.target.selectedIndex === event.target.options.length - 1;
            if (last) setTyping(true);
            else setChoice(event.target.value);
          }}
          className={controlClass}
        >
          <option value="">{labels.uncategorized}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
          {/* Empty value like 미분류: it is never submitted, because
              choosing it swaps this menu for the text box. */}
          <option value="">{labels.addNew}</option>
        </select>
      )}
    </div>
  );
}
