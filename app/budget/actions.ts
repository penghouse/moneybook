"use server";

import { eq } from "drizzle-orm";
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
  const noteRaw = formData.get("note");

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
  // Emptied back to null rather than to '': a blank string is a note
  // that says nothing, and the screen would then have to tell it apart
  // from a note nobody wrote.
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : null;

  await db
    .insert(budgets)
    .values({ sectionId: section.id, accountId, ...ref, amount, note })
    .onConflictDoUpdate({
      target: [budgets.accountId, budgets.period, budgets.periodKey],
      set: { amount, note },
    });

  // Revalidated, not redirected. The redirect went to the page the
  // reader was already on, and it throws — which a `useActionState`
  // reducer never settles, so the row's own 저장 would sit on 저장 중…
  // for good and never fold the box back up. See budget-field.tsx.
  revalidatePath("/budget");
}
