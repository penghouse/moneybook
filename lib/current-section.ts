import { eq } from "drizzle-orm";
import { sections, type Section } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Locale } from "@/i18n";
import { today } from "./date";
import { seedDefaultAccounts } from "./default-accounts";

const DEFAULT_BASE_CURRENCY = "KRW";
const DEFAULT_TIMEZONE = "Asia/Seoul";

/**
 * v1 gives each user exactly one section, created lazily on first visit
 * rather than through an onboarding flow — there is no section switcher
 * UI (see plan). The default chart of accounts is seeded once, here, in
 * whichever locale was active at the time.
 */
export async function getOrCreateSection(
  db: Db,
  params: { userId: string; locale: Locale },
): Promise<Section> {
  const existing = await db.query.sections.findFirst({
    where: eq(sections.userId, params.userId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(sections)
    .values({
      userId: params.userId,
      name: params.locale === "ko" ? "기본" : "Default",
      baseCurrency: DEFAULT_BASE_CURRENCY,
      timezone: DEFAULT_TIMEZONE,
      startDate: today(DEFAULT_TIMEZONE),
    })
    .returning();

  await seedDefaultAccounts(db, {
    sectionId: created.id,
    locale: params.locale,
    baseCurrency: created.baseCurrency,
  });

  return created;
}
