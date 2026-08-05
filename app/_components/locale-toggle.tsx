import { setLocale } from "@/i18n/actions";
import type { Locale } from "@/i18n";
import { buttonClass } from "./ui";

export function LocaleToggle({ locale, full = false }: { locale: Locale; full?: boolean }) {
  const other: Locale = locale === "ko" ? "en" : "ko";
  const label = other === "ko" ? "한국어" : "English";

  return (
    <form
      action={async () => {
        "use server";
        await setLocale(other);
      }}
      className={full ? "w-full" : undefined}
    >
      <button type="submit" className={buttonClass("secondary", full)}>
        {label}
      </button>
    </form>
  );
}
