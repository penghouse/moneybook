"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts, transactionLines, transactions, type Section } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import {
  assertBalanced,
  getUnrealizedFx,
  type BalanceLineInput,
  type ResolvedUnrealizedFx,
} from "@/lib/ledger";

// Looked up by either localized name so switching the UI language
// later doesn't spawn a second, duplicate FX account — see the plan's
// note that account names are user data, not translated on the fly.
const FX_GAIN_NAMES = ["외화환산이익", "FX Gain (Unrealized)"];
const FX_LOSS_NAMES = ["외화환산손실", "FX Loss (Unrealized)"];

async function ensureFxAccount(
  section: Section,
  group: "income" | "expense",
  knownNames: string[],
  freshName: string,
): Promise<string> {
  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.sectionId, section.id), inArray(accounts.name, knownNames)),
  });
  if (existing) return existing.id;

  const [{ maxSortOrder }] = await db
    .select({ maxSortOrder: sql<number>`coalesce(max(${accounts.sortOrder}), -1)` })
    .from(accounts)
    .where(eq(accounts.sectionId, section.id));

  const [created] = await db
    .insert(accounts)
    .values({
      sectionId: section.id,
      group,
      name: freshName,
      currency: section.baseCurrency,
      sortOrder: maxSortOrder + 1,
    })
    .returning();
  return created.id;
}

export async function revalueAction(formData: FormData) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const asOf = formData.get("asOf");
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("Invalid date");
  }

  const fx = await getUnrealizedFx(db, {
    sectionId: section.id,
    baseCurrency: section.baseCurrency,
    asOf,
  });
  // An account whose rate couldn't be resolved has no known unrealized
  // difference, so there is nothing to post for it — it is skipped
  // rather than treated as a zero difference.
  const toRevalue = fx.filter(
    (f): f is ResolvedUnrealizedFx => !f.rateUnavailable && f.unrealized !== 0,
  );

  if (toRevalue.length > 0) {
    const gainAccountId = await ensureFxAccount(
      section,
      "income",
      FX_GAIN_NAMES,
      t("fx.gainAccountName"),
    );
    const lossAccountId = await ensureFxAccount(
      section,
      "expense",
      FX_LOSS_NAMES,
      t("fx.lossAccountName"),
    );

    for (const f of toRevalue) {
      const isGain = f.unrealized > 0;
      const magnitude = Math.abs(f.unrealized);

      const lines: (BalanceLineInput & { accountId: string })[] = [
        {
          side: isGain ? "left" : "right",
          accountId: f.accountId,
          currency: f.currency,
          amount: 0,
          rate: null,
          baseAmount: magnitude,
        },
        {
          side: isGain ? "right" : "left",
          accountId: isGain ? gainAccountId : lossAccountId,
          currency: section.baseCurrency,
          amount: magnitude,
          rate: 1,
          baseAmount: magnitude,
        },
      ];
      assertBalanced(lines, section.baseCurrency, "revaluation");

      const [tx] = await db
        .insert(transactions)
        .values({
          sectionId: section.id,
          date: asOf,
          title: t("fx.revalueTitle"),
          kind: "revaluation",
        })
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
        })),
      );
    }
  }

  revalidatePath("/assets");
  revalidatePath("/income");
  redirect(`/assets?asOf=${asOf}&revalued=1`);
}
