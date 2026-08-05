import { NAV_HREFS } from "@/app/_components/nav-items";

/**
 * Which destinations get a cell in the phone's bottom bar.
 *
 * Stored on the section as a comma-separated href list, so it follows the
 * book across devices instead of living in a per-browser cookie like the
 * theme does. The list is *parsed* rather than trusted: an href that is
 * no longer a route is dropped, so renaming or retiring a page can never
 * leave a tab that navigates nowhere.
 *
 * Four is the cap because the bar also carries a fixed "더보기" cell, and
 * five cells at 360px is 72px each — enough for a three or four syllable
 * Korean label without shrinking the text.
 */
export const MAX_FAVORITES = 4;

export const DEFAULT_FAVORITES: readonly string[] = ["/", "/assets", "/income", "/budget"];

/** Real routes only, de-duplicated, capped, in the order given. */
export function parseFavorites(stored: string | null | undefined): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const raw of (stored ?? "").split(",")) {
    const href = raw.trim();
    if (!NAV_HREFS.includes(href) || seen.has(href)) continue;
    seen.add(href);
    kept.push(href);
    if (kept.length === MAX_FAVORITES) break;
  }

  // An empty bar is worse than a wrong one — it would leave "더보기" as
  // the only way to go anywhere.
  return kept.length > 0 ? kept : [...DEFAULT_FAVORITES];
}

export function serializeFavorites(hrefs: readonly string[]): string {
  return parseFavorites(hrefs.join(",")).join(",");
}
