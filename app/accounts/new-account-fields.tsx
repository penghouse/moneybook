"use client";

import { useState } from "react";
import { Label, controlClass } from "../_components/ui";
import type { AccountGroup } from "@/db/schema";

/**
 * The 분류 and 상위 그룹 fields of the new-account form, together.
 *
 * They are one control in practice: a 상위 그룹 belongs to a 분류 —
 * 「먹는 것」 is a way of grouping expenses and means nothing under
 * 자산 — so the suggestions have to follow whichever 분류 is selected.
 * A `<datalist>` is bound by id and cannot be swapped without script,
 * which is why these two live in a client component while the rest of
 * the form stays on the server.
 *
 * The fields themselves are still plain `<select name="group">` and
 * `<input name="category">`; the only thing state does here is point at
 * the right list.
 */
export function NewAccountFields({
  groups,
  groupLabels,
  categoryListPrefix,
  labels,
  placeholder,
}: {
  groups: readonly AccountGroup[];
  groupLabels: Record<AccountGroup, string>;
  /**
   * Prefix of the per-group `<datalist>` ids the page renders. A string
   * rather than the page's own id-building function, because functions
   * do not cross from a server component into a client one.
   */
  categoryListPrefix: string;
  labels: { group: string; category: string };
  placeholder: string;
}) {
  const [group, setGroup] = useState<AccountGroup>(
    groups.includes("expense") ? "expense" : groups[0],
  );

  return (
    <>
      <div className="min-w-0">
        <Label>{labels.group}</Label>
        <select
          name="group"
          value={group}
          onChange={(e) => setGroup(e.target.value as AccountGroup)}
          className={controlClass}
        >
          {groups.map((option) => (
            <option key={option} value={option}>
              {groupLabels[option]}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <Label>{labels.category}</Label>
        <input
          // Keyed by 분류, so changing it builds a new input rather than
          // re-pointing this one. Chromium binds an input to its datalist
          // when the element is created and keeps showing that list after
          // `list` changes — the attribute was right, the dropdown still
          // offered 비용's 상위 그룹 under 자산, and nothing in the DOM said
          // so. Remounting is what actually rebinds it.
          //
          // It also clears whatever was typed, which is the right thing
          // here: a 상위 그룹 written for 비용 means nothing under 자산.
          key={group}
          type="text"
          name="category"
          list={`${categoryListPrefix}${group}`}
          placeholder={placeholder}
          className={controlClass}
        />
      </div>
    </>
  );
}
