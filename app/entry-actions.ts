"use server";

import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, transactionLines, transactions } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { isActiveOn } from "@/lib/accounts";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { assertBalanced, type BalanceLineInput } from "@/lib/ledger";
import { convertMinorUnits, toMinorUnits } from "@/lib/money";

type LineWithAccount = BalanceLineInput & { accountId: string; memo: string | null };

/**
 * Rebuilds lines straight from the submitted form fields (parallel
 * getAll() arrays, one entry per line in DOM order — see entry-form.tsx)
 * and re-derives each line's currency from its account row rather than
 * trusting whatever the client sent, since transaction_lines.currency
 * must always match the referenced account's currency.
 *
 * Also the gate on account windows. The picker only offers accounts open
 * today, but the picker is an affordance and this is the rule: a
 * transaction may not be posted to an account that was not in use on its
 * own date.
 *
 * Checked against the *transaction's* date, not today, so a correction
 * dated back into the account's lifetime still goes in — which is the
 * whole reason a date interval beats an archived flag here.
 *
 * Deliberately not applied to any of the CSV import paths. A backup
 * contains the history of accounts that have since closed, and enforcing
 * this there would mean an export could no longer be restored — the one
 * thing a backup format has to guarantee. Import is a replay of what
 * already happened; this is the gate on what happens next.
 */
async function buildLines(
  formData: FormData,
  sectionId: string,
  baseCurrency: string,
  date: string,
): Promise<LineWithAccount[]> {
  const sides = formData.getAll("side").map(String);
  const accountIds = formData.getAll("accountId").map(String);
  const amounts = formData.getAll("amount").map(String);
  const rates = formData.getAll("rate").map(String);
  const lineMemos = formData.getAll("lineMemo").map(String);

  if (sides.length < 2 || sides.length !== accountIds.length) {
    throw new Error("Malformed transaction lines");
  }

  const accountRows = await db.query.accounts.findMany({
    where: inArray(accounts.id, [...new Set(accountIds)]),
  });
  const accountsById = new Map(accountRows.map((a) => [a.id, a]));

  return sides.map((side, i) => {
    if (side !== "left" && side !== "right") throw new Error("Invalid side");
    const account = accountsById.get(accountIds[i]);
    if (!account || account.sectionId !== sectionId) {
      throw new Error("Unknown or foreign account");
    }
    if (!isActiveOn(account, date)) {
      redirect(`/?error=account_inactive&name=${encodeURIComponent(account.name)}`);
    }

    const amountMajor = Number(amounts[i]);
    if (!Number.isFinite(amountMajor) || amountMajor < 0) {
      throw new Error("Invalid amount");
    }
    const amount = toMinorUnits(amountMajor, account.currency);
    const rate = account.currency === baseCurrency ? 1 : Number(rates[i]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid rate");
    const baseAmount = convertMinorUnits(amount, rate, account.currency, baseCurrency);

    return {
      side,
      accountId: account.id,
      currency: account.currency,
      amount,
      rate,
      baseAmount,
      memo: lineMemos[i]?.trim() || null,
    };
  });
}

function readHeader(formData: FormData) {
  const date = formData.get("date");
  const title = formData.get("title");
  const memo = formData.get("memo");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date");
  }
  // Title is optional: the two account names often already say enough
  // (e.g. 식비 -> 신용카드), and requiring it would add friction to the
  // most common, fastest entry path.
  return {
    date,
    title: typeof title === "string" ? title.trim() : "",
    memo: typeof memo === "string" && memo.trim() ? memo.trim() : null,
  };
}

export async function createTransactionAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const header = readHeader(formData);
  const lines = await buildLines(formData, section.id, section.baseCurrency, header.date);

  try {
    assertBalanced(lines, section.baseCurrency, "normal");
  } catch {
    redirect("/?error=unbalanced");
  }

  const [tx] = await db
    .insert(transactions)
    .values({ sectionId: section.id, ...header })
    .returning();

  await db.insert(transactionLines).values(
    lines.map((line, i) => ({
      transactionId: tx.id,
      lineOrder: i,
      side: line.side,
      accountId: line.accountId,
      currency: line.currency,
      amount: line.amount,
      rate: line.rate,
      baseAmount: line.baseAmount,
      memo: line.memo,
    })),
  );

  revalidatePath("/");

  // No redirect here, deliberately. `redirect()` throws, and this action
  // is awaited inside the entry form's useActionState reducer, where the
  // throw never resolves the transition — the save button sat on
  // 저장 중… forever. Dropping `?duplicate=` afterwards is the client's
  // job instead; see EntryForm's afterSaveHref.
}

export async function updateTransactionAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const transactionId = formData.get("transactionId");
  if (typeof transactionId !== "string") throw new Error("Missing transactionId");

  const existing = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
  });
  if (!existing || existing.sectionId !== section.id) {
    throw new Error("Transaction not found");
  }

  const header = readHeader(formData);
  const lines = await buildLines(formData, section.id, section.baseCurrency, header.date);

  try {
    assertBalanced(lines, section.baseCurrency, existing.kind);
  } catch {
    redirect("/?error=unbalanced");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ ...header, updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    await tx.delete(transactionLines).where(eq(transactionLines.transactionId, transactionId));
    await tx.insert(transactionLines).values(
      lines.map((line, i) => ({
        transactionId,
        lineOrder: i,
        side: line.side,
        accountId: line.accountId,
        currency: line.currency,
        amount: line.amount,
        rate: line.rate,
        baseAmount: line.baseAmount,
        memo: line.memo,
      })),
    );
  });

  revalidatePath("/");
}

export async function deleteTransactionAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const transactionId = formData.get("transactionId");
  if (typeof transactionId !== "string") throw new Error("Missing transactionId");

  const existing = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
  });
  if (!existing || existing.sectionId !== section.id) {
    throw new Error("Transaction not found");
  }

  // transaction_lines cascades on transactions.id.
  await db.delete(transactions).where(eq(transactions.id, transactionId));
  revalidatePath("/");
}
