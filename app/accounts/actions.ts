"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, ACCOUNT_GROUPS, type AccountGroup } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { addDays, today } from "@/lib/date";

/**
 * Blank means unfiled, and unfiled is null rather than "" — otherwise
 * the accounts list would grow an empty-named category heading that no
 * one asked for.
 */
function normalizeCategory(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An empty date input means "no bound", which is null rather than "". */
function normalizeDate(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

async function loadOwnedAccount(accountId: string, userId: string) {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    with: { section: true },
  });
  if (!account || account.section.userId !== userId) {
    throw new Error("Account not found");
  }
  return account;
}

export async function createAccountAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const group = formData.get("group");
  const name = formData.get("name");
  const currency = formData.get("currency");
  const category = formData.get("category");

  if (typeof group !== "string" || !ACCOUNT_GROUPS.includes(group as AccountGroup)) {
    throw new Error("Invalid group");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Name is required");
  }
  if (typeof currency !== "string" || currency.trim().length === 0) {
    throw new Error("Currency is required");
  }

  const [{ maxSortOrder }] = await db
    .select({
      maxSortOrder: sql<number>`coalesce(max(${accounts.sortOrder}), -1)`,
    })
    .from(accounts)
    .where(eq(accounts.sectionId, section.id));

  try {
    await db.insert(accounts).values({
      sectionId: section.id,
      group: group as AccountGroup,
      name: name.trim(),
      currency,
      category: normalizeCategory(category),
      sortOrder: maxSortOrder + 1,
    });
  } catch {
    redirect("/accounts?error=duplicate_name");
  }

  revalidatePath("/accounts");
}

export async function updateAccountAction(formData: FormData) {
  const userId = await requireUserId();
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string") throw new Error("Missing accountId");
  await loadOwnedAccount(accountId, userId);

  const name = formData.get("name");
  const memo = formData.get("memo");
  const category = formData.get("category");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Name is required");
  }

  const activeFrom = normalizeDate(formData.get("activeFrom"));
  const activeTo = normalizeDate(formData.get("activeTo"));
  // The database has a CHECK for this too; catching it here is what
  // turns it into a message rather than a stack trace.
  if (activeFrom !== null && activeTo !== null && activeFrom > activeTo) {
    redirect("/accounts?error=active_range");
  }

  try {
    await db
      .update(accounts)
      .set({
        name: name.trim(),
        memo: typeof memo === "string" && memo.trim() ? memo.trim() : null,
        category: normalizeCategory(category),
        activeFrom,
        activeTo,
      })
      .where(eq(accounts.id, accountId));
  } catch {
    redirect("/accounts?error=duplicate_name");
  }

  revalidatePath("/accounts");
}

/**
 * The one-tap version of setting an end date; the dated form is in
 * updateAccountAction, for when the real date is not around now —
 * retiring in April a card that was actually cut up in January.
 *
 * 「보관」 writes *yesterday*, not today. `active_to` is the last day the
 * account was in use, inclusive, so writing today would leave it usable
 * for the rest of the day — a button that appears to do nothing until
 * tomorrow. Pressing it says "not from here on", and the last day that
 * can have been is the day before.
 */
export async function toggleArchiveAction(formData: FormData) {
  const userId = await requireUserId();
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string") throw new Error("Missing accountId");
  const account = await loadOwnedAccount(accountId, userId);
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  // Keyed on "has an end date at all" rather than on whether that date
  // has passed, so the button can always undo itself — including a
  // close scheduled for next month.
  await db
    .update(accounts)
    .set({ activeTo: account.activeTo === null ? addDays(today(section.timezone), -1) : null })
    .where(eq(accounts.id, accountId));

  revalidatePath("/accounts");
}

export async function deleteAccountAction(formData: FormData) {
  const userId = await requireUserId();
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string") throw new Error("Missing accountId");
  await loadOwnedAccount(accountId, userId);

  try {
    await db.delete(accounts).where(eq(accounts.id, accountId));
  } catch {
    // FK restrict: this account is referenced by transaction_lines.
    redirect("/accounts?error=delete_restricted");
  }

  revalidatePath("/accounts");
}

export async function moveAccountAction(formData: FormData) {
  const userId = await requireUserId();
  const accountId = formData.get("accountId");
  const direction = formData.get("direction");
  if (typeof accountId !== "string" || typeof direction !== "string") {
    throw new Error("Missing accountId/direction");
  }
  if (direction !== "up" && direction !== "down") {
    throw new Error("Invalid direction");
  }

  const account = await loadOwnedAccount(accountId, userId);
  const siblings = await db.query.accounts.findMany({
    where: and(eq(accounts.sectionId, account.sectionId), eq(accounts.group, account.group)),
    orderBy: asc(accounts.sortOrder),
  });

  const index = siblings.findIndex((a) => a.id === accountId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) return;

  const other = siblings[swapIndex];
  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ sortOrder: other.sortOrder })
      .where(eq(accounts.id, account.id));
    await tx
      .update(accounts)
      .set({ sortOrder: account.sortOrder })
      .where(eq(accounts.id, other.id));
  });

  revalidatePath("/accounts");
}
