import { cookies } from "next/headers";

/**
 * Theme is stored in a cookie and read on the server, exactly like the
 * locale (see i18n/index.ts). The chosen value lands on <html data-theme>
 * during SSR, so the first paint is already correct — no inline script,
 * no flash of the wrong theme.
 *
 * "system" deliberately writes no attribute: the CSS falls back to
 * `prefers-color-scheme`, which is what following the device means.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const defaultTheme: Theme = "system";
export const themeCookieName = "theme";

export function isTheme(value: string | undefined | null): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}

export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(themeCookieName)?.value;
  return isTheme(value) ? value : defaultTheme;
}

/** The value for <html data-theme>; undefined means "follow the device". */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
