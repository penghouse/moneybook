import { setTheme } from "@/lib/theme-actions";
import { THEMES, type Theme } from "@/lib/theme";

export interface ThemeToggleLabels {
  legend: string;
  light: string;
  dark: string;
  system: string;
}

/**
 * A three-state segmented control. Server-rendered and submitted as a
 * plain form (same shape as LocaleToggle), so it works without
 * client-side JavaScript and the choice survives a reload.
 */
export function ThemeToggle({
  theme,
  labels,
  full = false,
}: {
  theme: Theme;
  labels: ThemeToggleLabels;
  full?: boolean;
}) {
  const text: Record<Theme, string> = {
    light: labels.light,
    dark: labels.dark,
    system: labels.system,
  };

  return (
    <form
      aria-label={labels.legend}
      className={`bg-sunken rounded-full p-1 ${full ? "flex w-full" : "inline-flex"}`}
    >
      {THEMES.map((value) => {
        const active = value === theme;
        return (
          <button
            key={value}
            type="submit"
            formAction={async () => {
              "use server";
              await setTheme(value);
            }}
            aria-pressed={active}
            className={`min-h-10 rounded-full px-3 text-sm whitespace-nowrap ${
              full ? "flex-1" : ""
            } ${active ? "bg-accent text-accent-ink font-semibold" : "text-ink-muted"}`}
          >
            {text[value]}
          </button>
        );
      })}
    </form>
  );
}
