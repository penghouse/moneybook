import { cookies } from "next/headers";
import ko from "./ko";
import en from "./en";

export const locales = ["ko", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ko";
export const localeCookieName = "locale";

export type TranslationKey = keyof typeof ko;

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  ko,
  en,
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(localeCookieName)?.value;
  return isLocale(value) ? value : defaultLocale;
}

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}

export async function getTranslations() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return { locale, t: (key: TranslationKey) => dict[key] };
}
