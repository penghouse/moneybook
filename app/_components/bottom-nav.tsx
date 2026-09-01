"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode, RefObject } from "react";

/**
 * The phone's bottom tab bar. Only the favourited destinations get a
 * cell; the last cell is always "더보기", which opens the same drawer
 * that used to hang off a hamburger in the header.
 *
 * The bar is what the thumb reaches without moving the hand, so the
 * destinations that are used constantly live here and the full list
 * stays one tap away.
 */

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/**
 * One glyph per route, in the same line style as the drawer's own
 * controls. `accounts` is deliberately a *bulleted* list rather than
 * three plain rules — three plain rules is the "더보기" hamburger, and
 * two cells that read as the same icon would be worse than no icons.
 */
const ICONS: Record<string, ReactNode> = {
  "/": (
    <svg {...ICON_PROPS}>
      <path d="M4 16v-3l9-9 3 3-9 9H4z" />
      <path d="M11.5 5.5l3 3" />
    </svg>
  ),
  "/assets": (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="14" height="10" rx="2" />
      <circle cx="13.5" cy="10" r="1.1" />
    </svg>
  ),
  "/assets/chart": (
    <svg {...ICON_PROPS}>
      <path d="M4 16V9M10 16V4M16 16v-5" />
    </svg>
  ),
  "/income": (
    <svg {...ICON_PROPS}>
      <path d="M3 13.5l4.5-4.5 3 3L16 6.5" />
      <path d="M12.5 6.5H16V10" />
    </svg>
  ),
  "/budget": (
    <svg {...ICON_PROPS}>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2.4" />
    </svg>
  ),
  "/accounts": (
    <svg {...ICON_PROPS}>
      <circle cx="4.6" cy="6" r="1.1" />
      <circle cx="4.6" cy="10" r="1.1" />
      <circle cx="4.6" cy="14" r="1.1" />
      <path d="M8.5 6H16M8.5 10H16M8.5 14H13" />
    </svg>
  ),
  "/settings": (
    <svg {...ICON_PROPS}>
      <path d="M3 6.5h6.5M13.5 6.5H17M3 13.5h3.5M10.5 13.5H17" />
      <circle cx="11.5" cy="6.5" r="1.8" />
      <circle cx="8.5" cy="13.5" r="1.8" />
    </svg>
  ),
};

const MORE_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M3 6h14M3 10h14M3 14h14" />
  </svg>
);

const cellClass =
  "flex h-14 flex-col items-center justify-center gap-1 px-1 " +
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

export function BottomNav({
  items,
  moreLabel,
  navLabel,
  moreRef,
  onMore,
}: {
  items: { href: string; label: string }[];
  moreLabel: string;
  navLabel: string;
  moreRef: RefObject<HTMLButtonElement | null>;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Tapping the tab you are already on reloads it.
   *
   * A `<Link>` to where you already are does nothing, which is right for
   * a page that cannot have changed and wrong for every page here — they
   * all read a database that a phone in a pocket has no way of hearing
   * about. Reaching for the tab again is what a person does when they
   * want to see the current state, and it was the one gesture that did
   * nothing at all.
   *
   * `window.location.search` rather than `useSearchParams`: this only
   * matters inside the handler, on the client, and the hook would put a
   * Suspense requirement on every page that renders the bar. A tab whose
   * page is showing with a query string on it — 예산 sitting on another
   * month — is a real navigation, so it is left to the link.
   */
  const retap = (href: string) => (event: React.MouseEvent) => {
    if (href !== pathname || window.location.search) return;
    event.preventDefault();
    router.refresh();
  };

  return (
    <nav
      aria-label={navLabel}
      // The safe-area padding is load-bearing: on an installed iOS app
      // the home indicator sits over the bottom edge, and without it the
      // row of labels ends up underneath.
      //
      // Do not write an arbitrary-value class inside a comment here.
      // Tailwind v4 scans source text for candidates rather than parsing
      // it, so a truncated example in a comment becomes a real rule —
      // one written with an ellipsis produced `padding-bottom: env(...)`
      // and failed the CSS parse for the whole app.
      className="bg-card border-rule-soft fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {/* Inline gridTemplateColumns: the cell count follows the saved
          favourites, and Tailwind cannot generate a class for a number
          it does not see at build time. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = item.href === pathname;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={retap(item.href)}
              aria-current={active ? "page" : undefined}
              className={`${cellClass} ${active ? "text-accent" : "text-ink-faint"}`}
            >
              {ICONS[item.href]}
              <span
                className={`w-full truncate text-center text-[11px] leading-none ${active ? "font-semibold" : ""}`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Visible text and accessible name are the same string. Labelling
            this "메뉴 열기" while it reads 더보기 would break
            label-in-name for anyone driving it by voice. */}
        <button
          ref={moreRef}
          type="button"
          onClick={onMore}
          className={`${cellClass} text-ink-faint`}
        >
          {MORE_ICON}
          <span className="w-full truncate text-center text-[11px] leading-none">{moreLabel}</span>
        </button>
      </div>
    </nav>
  );
}
