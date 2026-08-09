"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, ACCOUNT_GROUPS, sections, type AccountGroup } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { moveGroup, parseGroupOrder, serializeGroupOrder } from "@/lib/account-groups";
import {
  moveAccountWithinCategory,
  moveCategoryBlock,
  renumber,
  type MoveDirection,
  type OrderableAccount,
} from "@/lib/account-order";
import { canTrackCounterparties } from "@/lib/accounts";
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
  const account = await loadOwnedAccount(accountId, userId);

  const name = formData.get("name");
  const memo = formData.get("memo");
  const category = formData.get("category");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Name is required");
  }

  // The form no longer offers 사용 시작, so an absent field means "leave
  // it alone" rather than "clear it" — reading it as null would wipe a
  // start date brought in by a CSV import on the next unrelated save.
  const activeFrom = formData.has("activeFrom")
    ? normalizeDate(formData.get("activeFrom"))
    : account.activeFrom;
  const activeTo = normalizeDate(formData.get("activeTo"));
  // The database has a CHECK for this too; catching it here is what
  // turns it into a message rather than a stack trace.
  if (activeFrom !== null && activeTo !== null && activeFrom > activeTo) {
    redirect("/accounts?error=active_range");
  }

  // No CHECK backs this one, so this is the rule rather than a friendlier
  // rendering of it — an unchecked checkbox does not post at all, and the
  // group is the account's own, never the form's.
  const tracksCounterparties =
    formData.get("tracksCounterparties") === "1" && canTrackCounterparties(account.group);

  try {
    await db
      .update(accounts)
      .set({
        name: name.trim(),
        memo: typeof memo === "string" && memo.trim() ? memo.trim() : null,
        category: normalizeCategory(category),
        activeFrom,
        activeTo,
        tracksCounterparties,
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

/**
 * Moves one group up or down in the book's own listing order. The set of
 * groups is fixed; only the order is stored, and it is re-parsed on the
 * way in so a hand-posted form cannot drop a group or invent one.
 */
export async function moveGroupAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const group = formData.get("group");
  const direction = formData.get("direction");
  if (typeof group !== "string" || !ACCOUNT_GROUPS.includes(group as AccountGroup)) {
    throw new Error("Invalid group");
  }
  if (direction !== "up" && direction !== "down") {
    throw new Error("Invalid direction");
  }

  const next = moveGroup(parseGroupOrder(section.groupOrder), group as AccountGroup, direction);
  await db
    .update(sections)
    .set({ groupOrder: serializeGroupOrder(next) })
    .where(eq(sections.id, section.id));

  for (const path of ["/", "/accounts", "/assets", "/income", "/budget"]) {
    revalidatePath(path);
  }
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

function readDirection(formData: FormData): MoveDirection {
  const direction = formData.get("direction");
  if (direction !== "up" && direction !== "down") throw new Error("Invalid direction");
  return direction;
}

/**
 * Writes a group's new order, renumbering 0..n-1 so its category blocks
 * end up contiguous. That compaction is the point: while blocks were
 * interleaved, a move could swap an account with one from another
 * category and change nothing on screen.
 */
async function writeOrder(order: readonly OrderableAccount[]) {
  const changed = renumber(order);
  if (changed.length === 0) return;
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of changed) {
      await tx.update(accounts).set({ sortOrder }).where(eq(accounts.id, id));
    }
  });
  // Every screen lists accounts in this order, not just this one.
  for (const path of ["/", "/accounts", "/assets", "/income", "/budget"]) {
    revalidatePath(path);
  }
}

/** The accounts a move rearranges: one group of one section, in current order. */
async function siblingsOf(account: { sectionId: string; group: AccountGroup }) {
  return db.query.accounts.findMany({
    where: and(eq(accounts.sectionId, account.sectionId), eq(accounts.group, account.group)),
    orderBy: asc(accounts.sortOrder),
  });
}

export async function moveAccountAction(formData: FormData) {
  const userId = await requireUserId();
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string") throw new Error("Missing accountId");
  const direction = readDirection(formData);

  const account = await loadOwnedAccount(accountId, userId);
  const order = moveAccountWithinCategory(await siblingsOf(account), accountId, direction);
  // null means it is already at that end of its own category block. The
  // buttons are disabled there, so this is a stale click, not an error.
  if (order) await writeOrder(order);
}

/** Moves a whole 상위 그룹 within its group, accounts and all. */
export async function moveCategoryAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const group = formData.get("group");
  const category = formData.get("category");
  if (typeof group !== "string" || !ACCOUNT_GROUPS.includes(group as AccountGroup)) {
    throw new Error("Invalid group");
  }
  if (typeof category !== "string" || category.length === 0) {
    throw new Error("Missing category");
  }
  const direction = readDirection(formData);

  const siblings = await siblingsOf({ sectionId: section.id, group: group as AccountGroup });
  const order = moveCategoryBlock(siblings, category, direction);
  if (order) await writeOrder(order);
}
