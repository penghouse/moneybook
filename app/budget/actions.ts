"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { toMinorUnits } from "@/lib/money";

export async function setBudgetAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const accountId = formData.get("accountId");
  const yearMonth = formData.get("yearMonth");
  const amountStr = formData.get("amount");

  if (typeof accountId !== "string") throw new Error("Missing accountId");
  if (typeof yearMonth !== "string" || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error("Invalid yearMonth");
  }
  const amountMajor = typeof amountStr === "string" ? Number(amountStr) : NaN;
  if (!Number.isFinite(amountMajor) || amountMajor < 0) {
    throw new Error("Invalid amount");
  }

  const account = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
  if (!account || account.sectionId !== section.id) {
    throw new Error("Unknown account");
  }

  const amount = toMinorUnits(amountMajor, section.baseCurrency);

  await db
    .insert(budgets)
    .values({ sectionId: section.id, accountId, yearMonth, amount })
    .onConflictDoUpdate({
      target: [budgets.accountId, budgets.yearMonth],
      set: { amount },
    });

  revalidatePath("/budget");
  redirect(`/budget?yearMonth=${yearMonth}`);
}
