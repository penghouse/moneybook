"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { proposalFits } from "@/lib/analysis-tools";
import { parseBudgetPeriod } from "@/lib/budgets";
import { currentSection } from "@/lib/current-request";
import { toMinorUnits } from "@/lib/money";

/**
 * The rows the reader ticked, written as budgets.
 *
 * Re-checked here rather than trusted from the form. The proposal was
 * validated once on its way to the screen, but what comes back is a
 * browser's word for what was on it — so the accounts are looked up in
 * this section again, and the figures go past the same bounds a second
 * time. The press is what authorises the write; it is not evidence about
 * what is being written.
 *
 * The reason goes into the budget's note. Three months on, 교통비 15만
 * with nothing beside it is a number nobody can account for, and the one
 * thing the book can still say is why it was set.
 */
export async function applyBudgetProposalAction(formData: FormData) {
  const { section } = await currentSection();

  const ref = parseBudgetPeriod(String(formData.get("period") ?? ""));
  if (!ref || ref.period !== "month") throw new Error("Invalid period");

  const accountIds = formData.getAll("accountId").map(String);
  const amounts = formData.getAll("amountMajor").map((v) => Number(v));
  const whys = formData.getAll("why").map(String);
  if (accountIds.length === 0) return;
  if (accountIds.length !== amounts.length || accountIds.length !== whys.length) {
    throw new Error("Malformed proposal");
  }

  const owned = await db.query.accounts.findMany({
    where: and(eq(accounts.sectionId, section.id), inArray(accounts.id, accountIds)),
    columns: { id: true },
  });
  const ownedIds = new Set(owned.map((a) => a.id));

  const existing = await db.query.budgets.findMany({
    where: and(
      eq(budgets.sectionId, section.id),
      eq(budgets.period, "month"),
      eq(budgets.periodKey, ref.periodKey),
    ),
    columns: { accountId: true, amount: true },
  });
  const currentByAccountId = new Map(existing.map((b) => [b.accountId, b.amount]));

  for (const [i, accountId] of accountIds.entries()) {
    if (!ownedIds.has(accountId)) continue;
    if (!proposalFits(currentByAccountId.get(accountId), amounts[i])) continue;

    const amount = toMinorUnits(amounts[i], section.baseCurrency);
    const note = whys[i].trim().slice(0, 200) || null;
    await db
      .insert(budgets)
      .values({
        sectionId: section.id,
        accountId,
        period: "month",
        periodKey: ref.periodKey,
        amount,
        note,
      })
      .onConflictDoUpdate({
        target: [budgets.accountId, budgets.period, budgets.periodKey],
        set: { amount, note },
      });
  }

  revalidatePath("/budget");
}
