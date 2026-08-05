"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The horizontal bar shown from `md:` up. Client-side only because the
 * current route decides which item is highlighted; everything else in
 * the layout stays a server component.
 *
 * `overflow-x-auto` is load-bearing between roughly 768 and 1024px: the
 * title, seven destinations and the theme/locale/logout controls do not
 * fit on one row there, and without it the whole page scrolled sideways.
 * Wide content scrolls inside its own container, never by moving the
 * page — the same rule the transaction table follows.
 */
export function DesktopNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="hidden min-w-0 items-center gap-0.5 overflow-x-auto md:flex">
      {items.map((item) => {
        const active = item.href === pathname;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-control focus-visible:outline-accent flex min-h-11 items-center px-3 text-sm whitespace-nowrap focus-visible:outline-2 ${
              active ? "bg-accent-soft text-accent font-semibold" : "text-ink-muted hover:bg-sunken"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
