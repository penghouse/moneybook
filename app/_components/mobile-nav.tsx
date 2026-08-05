"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BottomNav } from "./bottom-nav";

/**
 * The whole of mobile navigation: the bottom tab bar and the drawer it
 * opens. The two are one component because they share a single piece of
 * state — splitting the opener out into the bar would leave `open` owned
 * by one and toggled by the other.
 *
 * Layout note: the drawer panel is a plain flex child, never absolutely
 * positioned. An earlier draft used `position:absolute` + `inset`, and
 * the panel collapsed to min-content — which for Korean is one glyph
 * wide, so "자산현황" rendered as four stacked characters. Static flex
 * plus `whitespace-nowrap` on the links makes that unrepresentable.
 */
export function MobileNav({
  items,
  favorites,
  footer,
  moreLabel,
  closeLabel,
  title,
}: {
  items: { href: string; label: string }[];
  favorites: { href: string; label: string }[];
  footer: ReactNode;
  moreLabel: string;
  closeLabel: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  // Close on navigation — otherwise the drawer stays over the page the
  // user just asked for. Adjusted during render rather than in an effect
  // so the drawer is already gone on the first paint of the new route.
  const [renderedAt, setRenderedAt] = useState(pathname);
  if (renderedAt !== pathname) {
    setRenderedAt(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        openerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <BottomNav
        items={favorites}
        moreLabel={moreLabel}
        navLabel={title}
        moreRef={openerRef}
        onMore={() => setOpen(true)}
      />

      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Scrim first, so the panel sits against the *right* edge —
              the side the "더보기" button that opens it lives on. It is a
              fixed-width flex sibling, so the panel's width never depends
              on how a containing block is resolved. */}
          <button
            type="button"
            data-testid="drawer-scrim"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
            className="w-16 shrink-0 bg-black/45"
          />

          <div
            id={panelId}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="bg-card flex min-w-0 flex-1 flex-col"
          >
            <div className="border-rule-soft flex h-14 items-center gap-2 border-b px-1">
              <span className="pl-3 font-semibold tracking-tight">{title}</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openerRef.current?.focus();
                }}
                aria-label={closeLabel}
                className="text-ink rounded-control focus-visible:outline-accent ml-auto grid size-11 place-items-center focus-visible:outline-2"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
              {items.map((item) => {
                const active = item.href === pathname;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[3.125rem] items-center border-l-[3px] px-4 whitespace-nowrap ${
                      active
                        ? "border-accent bg-accent-soft text-ink font-semibold"
                        : "text-ink-muted border-transparent"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-rule-soft grid gap-3 border-t px-4 py-4">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}
