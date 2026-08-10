import { db } from "@/db/client";
import type { Section } from "@/db/schema";
import { getTranslations, type Locale } from "@/i18n";
import type { Translate } from "@/i18n/format";
import { getOrCreateSection } from "./current-section";
import { requireUserId } from "./current-user";

export interface CurrentSection {
  userId: string;
  section: Section;
  t: Translate;
  locale: Locale;
}

/**
 * Who is asking, which book, and in which language — the three things
 * every page and every server action needs before it can do anything.
 *
 * Kept apart from `getOrCreateSection`, which takes its `db` as an
 * argument and is therefore testable against an in-memory database. This
 * one reaches for the real client and the request's cookies, so importing
 * it from a unit test would open the on-disk file as a side effect.
 */
export async function currentSection(): Promise<CurrentSection> {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  return { userId, section, t, locale };
}
