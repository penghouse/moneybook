"use client";

import { useState } from "react";
import type { AccountGroup } from "@/db/schema";
import { matchesQuery } from "@/lib/hangul";
// The leaf module, not the "@/lib/ledger" barrel: importing the barrel
// from a client component would pull the whole query layer — drizzle and
// all — into the browser bundle for one predicate.
import { isCreditNormal } from "@/lib/ledger/normal-balance";

export interface ComboboxAccount {
  id: string;
  name: string;
  currency: string;
  group: AccountGroup;
}

/**
 * The tag on the leading edge of the picker, worked out from the account
 * rather than from which box it sits in.
 *
 * By side alone, the right-hand box always read 「−」: income arriving on
 * the right looked like a loss, and a card charge — which *raises* what
 * you owe — looked like a reduction. Both are the same mistake, the box
 * describing its own position instead of what the leg does.
 *
 * 수익 and 비용 carry no sign at all. They only ever run one way, so a
 * sign is a question nobody was asking; the colour says which of the two
 * it is, and the account's own name is right beside it.
 *
 * Everything else — 자산, 부채, 자본 — gets the sign of what this leg
 * does to *that account's* balance, which is the credit-normal rule the
 * reports are built on.
 */
function tagFor(group: AccountGroup | undefined, side: "left" | "right" | undefined) {
  if (group === "income") return { className: "bg-positive", glyph: "" };
  if (group === "expense") return { className: "bg-negative", glyph: "" };

  const raises = group ? (side === "left") !== isCreditNormal(group) : side === "left";
  return {
    className: raises ? "bg-accent" : "bg-ink-faint",
    glyph: raises ? "+" : "−",
  };
}

/**
 * The account picker, drawn as one control with a coloured +/− tag on the
 * leading edge so a leg's direction is readable without reading the
 * label above it.
 *
 * `defaultAccountId` is treated as a value the parent may change (the
 * swap button does exactly that), not just an initial value — otherwise
 * swapping would move the hidden ids while both boxes kept showing the
 * old names.
 */
export function AccountCombobox({
  name,
  accounts,
  defaultAccountId,
  placeholder,
  side,
  groupLabels,
  onSelect,
}: {
  name: string;
  accounts: ComboboxAccount[];
  defaultAccountId?: string;
  placeholder?: string;
  side?: "left" | "right";
  /** 분류 names, so a row can say what it is rather than only hint at it. */
  groupLabels?: Record<AccountGroup, string>;
  onSelect?: (account: ComboboxAccount) => void;
}) {
  const nameOf = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? "";

  const [selectedId, setSelectedId] = useState(defaultAccountId ?? "");
  const [query, setQuery] = useState(nameOf(defaultAccountId));
  const [open, setOpen] = useState(false);

  // Adopt an externally changed selection during render, so a parent-driven
  // swap is reflected immediately rather than one interaction late.
  const [syncedId, setSyncedId] = useState(defaultAccountId ?? "");
  if ((defaultAccountId ?? "") !== syncedId) {
    setSyncedId(defaultAccountId ?? "");
    setSelectedId(defaultAccountId ?? "");
    setQuery(nameOf(defaultAccountId));
  }

  const filtered = accounts.filter((a) => matchesQuery(a.name, query));
  // Before anything is picked there is no account to describe, so the tag
  // falls back to the side — which is what the label above it says too.
  const tag = tagFor(accounts.find((a) => a.id === selectedId)?.group, side);

  return (
    // min-w-0: the text input inside carries an intrinsic default width,
    // which as a grid/flex item becomes an automatic minimum and would
    // widen the whole column past its container.
    <div className="relative min-w-0">
      <input type="hidden" name={name} value={selectedId} />
      {/* data-control marks the box a finger actually lands on. This is a
          composite control — chrome on the wrapper, the field inside —
          so the wrapper, not the bare <input>, is the touch target that
          e2e/mobile.spec.ts measures. */}
      <div
        data-control
        className="bg-sunken rounded-control focus-within:outline-accent flex min-h-12 items-center overflow-hidden focus-within:outline-2 focus-within:outline-offset-[-2px]"
      >
        {/* Narrower on a phone. At 360px every pixel of chrome here costs
            about a sixth of a Korean glyph out of the account name, and
            this tag is the one piece that repeats what the label above
            already says. */}
        {side && (
          <span
            aria-hidden="true"
            data-tag={tag.glyph || "none"}
            className={`text-accent-ink grid w-5 shrink-0 place-items-center self-stretch text-sm leading-none font-bold md:w-7 md:text-[15px] ${tag.className}`}
          >
            {tag.glyph}
          </span>
        )}
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          // flex-1 + min-w-0 rather than w-100%: a percentage width against
          // a shrink-to-fit parent is circular and collapses to min-content,
          // which for Korean is a single glyph.
          //
          // self-stretch is what makes this a real touch target. The 44px
          // belongs to the wrapper; without it the input itself is 24px
          // tall and tapping the wrapper's padding focuses nothing — on
          // the control this app is tapped through more than any other.
          className="text-ink min-w-0 flex-1 self-stretch bg-transparent px-2 outline-none md:px-2.5"
          autoComplete="off"
        />
      </div>
      {open && (
        // The list is absolutely positioned, so it is not bound to the
        // width of the box that opened it — and it should not be. Half a
        // phone row is four or five Korean glyphs, which is not enough to
        // tell 「생활비카드」 from 「생활비통장」, and truncating the very
        // names you are choosing between defeats the picker.
        //
        // `w-max` sizes to the longest name and `min-w-full` keeps it at
        // least as wide as the box. It grows away from the edge it is
        // anchored to, so the right-hand box's list opens leftward and
        // both stay on screen: each box sits ~36px in from its side of a
        // 320px viewport, which leaves 16rem to grow into. A viewport
        // cap would not work — it bounds the width, not the far edge,
        // and the list starts a third of the way across.
        <ul
          className={`bg-card rounded-control ring-rule absolute z-20 mt-1 max-h-56 w-max max-w-64 min-w-full overflow-auto shadow-lg ring-1 ${
            side === "right" ? "right-0" : "left-0"
          }`}
        >
          {filtered.length === 0 ? (
            <li className="text-ink-faint px-3 py-2 text-sm">—</li>
          ) : (
            filtered.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedId(a.id);
                    setSyncedId(a.id);
                    setQuery(a.name);
                    setOpen(false);
                    onSelect?.(a);
                  }}
                  className="hover:bg-sunken flex min-h-12 w-full items-center gap-2 py-2 pr-3.5 pl-2 text-left"
                >
                  {/* The same tag the box wears once this row is picked,
                      so the direction is known before choosing rather
                      than after. */}
                  {side && (
                    <span
                      aria-hidden="true"
                      className={`text-accent-ink grid size-5 shrink-0 place-items-center rounded text-xs leading-none font-bold ${tagFor(a.group, side).className}`}
                    >
                      {tagFor(a.group, side).glyph}
                    </span>
                  )}
                  <span className="min-w-0 truncate">{a.name}</span>
                  {/* Named, not just coloured. The tag says which way the
                      money goes; this says what the account *is*, which
                      is the thing a colour cannot spell. */}
                  {groupLabels && (
                    <span className="text-ink-faint ml-auto shrink-0 text-xs">
                      {groupLabels[a.group]}
                    </span>
                  )}
                  <span
                    className={`text-ink-faint shrink-0 text-xs ${groupLabels ? "" : "ml-auto"}`}
                  >
                    {a.currency}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
