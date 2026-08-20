"use client";

import { useState, type ReactNode } from "react";
import { foldCookieName, serializeFolds, type FoldScope } from "@/lib/category-folds";

/**
 * A 상위 그룹 band that puts its rows away.
 *
 * The bands were headings you could only read past. A book filed into
 * 유동성자금 / 투자 / 묶인돈 / 연금 shows every account under every one of
 * them, and the reader who came to look at 투자 scrolls through the
 * other three to get there — on a phone, several screens of it.
 *
 * The band itself is the control, not a chevron beside it: it already
 * spans the width, already names what it covers, and a 44px target that
 * is the whole heading beats an 11px one at its edge. The chevron stays
 * as the affordance, because a heading that happens to be clickable and
 * one that is not look identical otherwise.
 *
 * Not `<details>`: the subtotal on the right of the band has to stay
 * visible when the rows are away — it is the whole point of folding —
 * and `<summary>` in a flex row fights that in every browser. This is
 * a button and a region, which is what the pattern actually is.
 */
export function CategoryFold({
  scope,
  name,
  band,
  children,
  initialFolded,
  allFolded,
  testId,
}: {
  scope: FoldScope;
  /** The 상위 그룹's own name, as stored. Its identity in the cookie. */
  name: string;
  /** What the band shows — a subtotal, a progress bar, whatever the screen has. */
  band: ReactNode;
  children: ReactNode;
  initialFolded: boolean;
  /** Every folded name as the page was rendered, so a toggle can write the rest back. */
  allFolded: readonly string[];
  testId?: string;
}) {
  const [folded, setFolded] = useState(initialFolded);

  const toggle = () => {
    const next = !folded;
    setFolded(next);
    // Written straight to the cookie rather than through a server
    // action: the band has to answer the press immediately, and the
    // server only needs to know by the next navigation.
    const names = next
      ? [...new Set([...allFolded, name])]
      : allFolded.filter((other) => other !== name);
    document.cookie = `${foldCookieName(scope)}=${serializeFolds(names)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!folded}
        data-testid={testId}
        data-folded={folded ? "true" : undefined}
        className="hover:bg-rule-soft bg-sunken border-rule-soft flex w-full items-center gap-2 border-t px-4 py-1.5 text-left first:border-t-0"
      >
        <span
          aria-hidden="true"
          className={`text-ink-faint shrink-0 text-[9px] leading-none transition-transform ${
            folded ? "" : "rotate-90"
          }`}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">{band}</span>
      </button>
      {!folded && children}
    </div>
  );
}
