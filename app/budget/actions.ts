"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { parseBudgetPeriod } from "@/lib/budgets";
import { toMinorUnits } from "@/lib/money";
import { currentSection } from "@/lib/current-request";

export async function setBudgetAction(formData: FormData) {
  const { section } = await currentSection();

  const accountId = formData.get("accountId");
  const periodParam = formData.get("period");
  const amountStr = formData.get("amount");

  if (typeof accountId !== "string") throw new Error("Missing accountId");
  const ref = typeof periodParam === "string" ? parseBudgetPeriod(periodParam) : null;
  if (!ref) throw new Error("Invalid period");
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
    .values({ sectionId: section.id, accountId, ...ref, amount })
    .onConflictDoUpdate({
      target: [budgets.accountId, budgets.period, budgets.periodKey],
      set: { amount },
    });

  revalidatePath("/budget");
  redirect(`/budget?period=${ref.periodKey}`);
}
