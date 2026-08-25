"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, transactionLines, transactions } from "@/db/schema";
import { isActiveOn } from "@/lib/accounts";
import { assertBalanced, type BalanceLineInput } from "@/lib/ledger";
import { convertMinorUnits, toMinorUnits } from "@/lib/money";
import { currentSection } from "@/lib/current-request";

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
/**
 * What the server refused, said in a way the form can show without
 * losing what was typed.
 *
 * These used to be `redirect("/?error=…")`. The redirect worked — the
 * banner appeared — but navigating remounted the entry form, so every
 * field went back to blank and the save button switched off with it.
 * The reader had filled in a payment, pressed 저장, and watched the whole
 * thing disappear behind a message about one field.
 */
export interface EntryRejection {
  reason: "account_missing" | "account_inactive" | "unbalanced";
  /** The account the reason is about, where there is one. */
  name?: string;
}

class RejectedEntry extends Error {
  constructor(readonly detail: EntryRejection) {
    super(detail.reason);
  }
}

/** Runs the write and turns a refusal back into a value. */
async function rejectable(run: () => Promise<void>): Promise<EntryRejection | undefined> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RejectedEntry) return error.detail;
    throw error;
  }
}

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

  // Scoped to the section in the query, not only in the check below.
  // The ids arrive in a form body, so naming somebody else's account has
  // to come back empty rather than come back and be rejected — one
  // fence in the database, one in the code, and neither relying on the
  // other having been remembered.
  const accountRows = await db.query.accounts.findMany({
    where: and(eq(accounts.sectionId, sectionId), inArray(accounts.id, [...new Set(accountIds)])),
  });
  const accountsById = new Map(accountRows.map((a) => [a.id, a]));

  return sides.map((side, i) => {
    if (side !== "left" && side !== "right") throw new Error("Invalid side");
    const account = accountsById.get(accountIds[i]);
    if (!account || account.sectionId !== sectionId) {
      // Told, not thrown. This is reachable without tampering — the form
      // holds ids chosen when the page rendered, and an account deleted
      // in another tab (or a leg never picked from the list) arrives
      // here as an id that no longer resolves. Throwing put the whole
      // screen behind "A server error occurred", which says nothing
      // about the one field that needs fixing and loses the entry.
      throw new RejectedEntry({ reason: "account_missing" });
    }
    if (!isActiveOn(account, date)) {
      throw new RejectedEntry({ reason: "account_inactive", name: account.name });
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

export async function createTransactionAction(
  formData: FormData,
): Promise<EntryRejection | undefined> {
  return rejectable(async () => {
    const { section } = await currentSection();

    const header = readHeader(formData);
    const lines = await buildLines(formData, section.id, section.baseCurrency, header.date);

    try {
      assertBalanced(lines, section.baseCurrency, "normal");
    } catch {
      throw new RejectedEntry({ reason: "unbalanced" });
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

    // Nothing throws its way out of here on the happy path either.
    // `redirect()` throws, and this action is awaited inside the entry
    // form's useActionState reducer, where the throw never resolves the
    // transition — the save button sat on 저장 중… forever. Dropping
    // `?duplicate=` afterwards is the client's job instead; see
    // EntryForm's afterSaveHref.
  });
}

export async function updateTransactionAction(
  formData: FormData,
): Promise<EntryRejection | undefined> {
  return rejectable(async () => {
    const { section } = await currentSection();

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
      throw new RejectedEntry({ reason: "unbalanced" });
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
  });
}

export async function deleteTransactionAction(formData: FormData) {
  const { section } = await currentSection();

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
