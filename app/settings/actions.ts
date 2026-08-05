"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sections, transactions } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { setManualRate } from "@/lib/exchange-rates";
import { serializeFavorites } from "@/lib/nav-favorites";
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from "@/lib/options";

export async function updateSectionSettingsAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const name = formData.get("name");
  const baseCurrency = formData.get("baseCurrency");
  const timezone = formData.get("timezone");

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Name is required");
  }
  if (
    typeof baseCurrency !== "string" ||
    !CURRENCY_OPTIONS.includes(baseCurrency as (typeof CURRENCY_OPTIONS)[number])
  ) {
    throw new Error("Invalid base currency");
  }
  if (
    typeof timezone !== "string" ||
    !TIMEZONE_OPTIONS.includes(timezone as (typeof TIMEZONE_OPTIONS)[number])
  ) {
    throw new Error("Invalid timezone");
  }

  // Every stored baseAmount is denominated in the section's base
  // currency at the time it was posted; changing it after the fact would
  // silently relabel every past transaction into the new currency. Only
  // allow the change while the section has no transactions yet.
  if (baseCurrency !== section.baseCurrency) {
    const hasTransactions = await db.query.transactions.findFirst({
      where: eq(transactions.sectionId, section.id),
    });
    if (hasTransactions) {
      redirect("/settings?error=base_currency_locked");
    }
  }

  await db
    .update(sections)
    .set({ name: name.trim(), baseCurrency, timezone })
    .where(eq(sections.id, section.id));

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function updateNavFavoritesAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  // serializeFavorites drops anything that is not a real route and
  // enforces the cap, so a hand-posted form cannot put a dead tab — or
  // fifteen tabs — into the bottom bar.
  const hrefs = formData.getAll("href").filter((v) => typeof v === "string") as string[];

  await db
    .update(sections)
    .set({ navFavorites: serializeFavorites(hrefs) })
    .where(eq(sections.id, section.id));

  // The bar lives in the root layout, so every route renders it.
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

export async function setManualRateAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const date = formData.get("date");
  const base = formData.get("base");
  const rate = formData.get("rate");

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date");
  }
  if (
    typeof base !== "string" ||
    !CURRENCY_OPTIONS.includes(base as (typeof CURRENCY_OPTIONS)[number])
  ) {
    throw new Error("Invalid currency");
  }
  const rateNumber = typeof rate === "string" ? Number(rate) : NaN;
  if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
    throw new Error("Invalid rate");
  }

  await setManualRate(db, { date, base, quote: section.baseCurrency, rate: rateNumber });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
