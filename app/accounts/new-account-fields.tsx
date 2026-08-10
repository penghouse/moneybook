"use client";

import { useState } from "react";
import { Label, controlClass } from "../_components/ui";
import type { AccountGroup } from "@/db/schema";
import { CategoryField, type CategoryFieldLabels } from "./category-field";

/**
 * The 분류 and 상위 그룹 fields of the new-account form, together.
 *
 * They are one control in practice: a 상위 그룹 belongs to a 분류 —
 * 「먹는 것」 is a way of grouping expenses and means nothing under
 * 자산 — so the menu has to follow whichever 분류 is selected, which is
 * why these two live in a client component while the rest of the form
 * stays on the server.
 */
export function NewAccountFields({
  groups,
  groupLabels,
  categoriesByGroup,
  labels,
}: {
  groups: readonly AccountGroup[];
  groupLabels: Record<AccountGroup, string>;
  /** The 상위 그룹 in use, per 분류. A plain object: it has to cross into
   *  the client, and a function would not. */
  categoriesByGroup: Record<string, string[]>;
  labels: { group: string; category: CategoryFieldLabels };
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
      {/* Keyed by 분류 so changing it starts the field over: a 상위 그룹
          picked — or typed — for 비용 is not a thing under 자산, and
          carrying it across is how it gets saved on the wrong one. */}
      <CategoryField
        key={group}
        categories={categoriesByGroup[group] ?? []}
        labels={labels.category}
      />
    </>
  );
}
