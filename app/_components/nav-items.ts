import type { TranslationKey } from "@/i18n";

/**
 * One source for the nav, shared by the desktop bar, the mobile drawer
 * and the bottom bar, so the three can never drift out of order — and so
 * a saved bottom-bar favourite can be validated against a real route
 * (see lib/nav-favorites.ts).
 */
export const NAV_ITEMS: { href: string; labelKey: TranslationKey }[] = [
  { href: "/", labelKey: "nav.entry" },
  { href: "/assets", labelKey: "nav.assets" },
  { href: "/assets/chart", labelKey: "nav.assetsChart" },
  { href: "/income", labelKey: "nav.income" },
  { href: "/income/chart", labelKey: "nav.incomeChart" },
  { href: "/budget", labelKey: "nav.budget" },
  { href: "/formulas", labelKey: "nav.formulas" },
  { href: "/accounts", labelKey: "nav.accounts" },
  { href: "/settings", labelKey: "nav.settings" },
];

export const NAV_HREFS: readonly string[] = NAV_ITEMS.map((item) => item.href);
