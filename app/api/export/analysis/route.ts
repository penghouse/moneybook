import { and, asc, desc, eq, gte, like, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accounts, budgets, formulas, transactionLines, transactions } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { GROUP_LABEL_KEY } from "@/i18n/groups";
import { parseGroupOrder } from "@/lib/account-groups";
import {
  buildAnalysisExport,
  type ExportBudgetNote,
  type ExportFormula,
  type ExportTransaction,
} from "@/lib/analysis-export";
import { addMonths, monthRange, today, yearMonthOf, yearOf } from "@/lib/date";
import { formulaTotalLabels } from "@/app/_components/formula-section";
import { buildFormulaItems, formulaValues } from "@/lib/formula-items";
import { evaluateFormula, parseTerms } from "@/lib/formulas";
import { getAccountBalances, getFirstLedgerMonth, getMonthlyAccountAmounts } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { buildYearOverview } from "@/lib/year-overview";
import { unauthorizedJson } from "../../csv/stream";

/** How far back the entries themselves travel. Before that, monthly totals only. */
const TRANSACTION_MONTHS = 6;

/**
 * The book as one file to hand an assistant, rather than to restore from.
 *
 * The CSV exports beside this one are a backup: every transaction, no
 * plans, no shape. This is the other half — the year's shape, what was
 * planned against it, what was written on the plans, and only the recent
 * entries. A file meant to be read rather than replayed.
 */
export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedJson();
  }

  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const now = today(section.timezone);
  const year = yearOf(now);
  const currentMonth = yearMonthOf(now);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const txFrom = monthRange(addMonths(currentMonth, -(TRANSACTION_MONTHS - 1))).from;

  const [catalog, budgetRows, actualByMonth, firstLedgerMonth, balances, formulaRows] =
    await Promise.all([
      db.query.accounts.findMany({
        where: eq(accounts.sectionId, section.id),
        orderBy: asc(accounts.sortOrder),
        columns: { id: true, name: true, group: true, category: true },
      }),
      db.query.budgets.findMany({
        where: and(
          eq(budgets.sectionId, section.id),
          eq(budgets.period, "month"),
          like(budgets.periodKey, `${year}-%`),
        ),
        columns: { periodKey: true, accountId: true, amount: true, note: true },
      }),
      getMonthlyAccountAmounts(db, { sectionId: section.id, months, mode: "flow" }),
      getFirstLedgerMonth(db, section.id),
      getAccountBalances(db, { sectionId: section.id, asOf: now }),
      db.query.formulas.findMany({
        where: eq(formulas.sectionId, section.id),
        orderBy: asc(formulas.sortOrder),
      }),
    ]);

  const budgetByMonth = new Map<string, Map<string, number>>();
  for (const row of budgetRows) {
    const bucket = budgetByMonth.get(row.periodKey) ?? new Map<string, number>();
    bucket.set(row.accountId, row.amount);
    budgetByMonth.set(row.periodKey, bucket);
  }

  const groupOrder = parseGroupOrder(section.groupOrder);
  const overview = buildYearOverview({
    accounts: catalog,
    months,
    currentMonth,
    firstLedgerMonth,
    actualByMonth,
    budgetByMonth,
    groupOrder,
  });

  const money = (minor: number) => formatMoney(minor, section.baseCurrency, locale);
  const nameById = new Map(catalog.map((a) => [a.id, a.name]));

  const budgetNotes: ExportBudgetNote[] = budgetRows
    .filter((row) => row.note?.trim())
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .map((row) => ({
      periodKey: row.periodKey,
      account: nameById.get(row.accountId) ?? "?",
      amount: money(row.amount),
      note: row.note!.trim(),
    }));

  // The reader's own metrics, which say what they actually watch. Income
  // formulas read the year so far; asset ones read today's balance sheet.
  const amountByAccountId = new Map<string, number>();
  for (const month of months.filter((m) => m <= currentMonth)) {
    for (const [accountId, amount] of actualByMonth.get(month) ?? []) {
      amountByAccountId.set(accountId, (amountByAccountId.get(accountId) ?? 0) + amount);
    }
  }
  const valuesByScope = {
    income: {
      byKey: formulaValues(
        buildFormulaItems({
          scope: "income",
          groupOrder,
          accounts: catalog,
          amountByAccountId,
          labels: { totals: formulaTotalLabels("income", t) },
        }),
      ),
    },
    assets: {
      byKey: formulaValues(
        buildFormulaItems({
          scope: "assets",
          groupOrder,
          accounts: catalog,
          amountByAccountId: new Map(balances.map((b) => [b.accountId, b.baseAmount])),
          labels: { totals: formulaTotalLabels("assets", t) },
        }),
      ),
    },
  };
  const exportFormulas: ExportFormula[] = formulaRows.flatMap((row) => {
    const outcome = evaluateFormula(
      { terms: parseTerms(row.terms), expression: row.expression },
      valuesByScope[row.scope],
      section.baseCurrency,
    );
    return outcome.ok
      ? [
          {
            scope: row.scope,
            name: `${row.name} (${row.scope === "income" ? `${year} 누계` : `${now} 기준`})`,
            value: money(outcome.amount),
          },
        ]
      : [];
  });

  const lines = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      title: transactions.title,
      memo: transactions.memo,
      side: transactionLines.side,
      accountId: transactionLines.accountId,
      amount: transactionLines.baseAmount,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.sectionId, section.id),
        gte(transactions.date, txFrom),
        lte(transactions.date, now),
      ),
    )
    .orderBy(desc(transactions.date), asc(transactions.id));

  const byTransaction = new Map<
    string,
    {
      date: string;
      title: string;
      memo: string | null;
      left: string[];
      right: string[];
      amount: number;
    }
  >();
  for (const line of lines) {
    const entry = byTransaction.get(line.id) ?? {
      date: line.date,
      title: line.title,
      memo: line.memo,
      left: [],
      right: [],
      amount: 0,
    };
    const name = nameById.get(line.accountId) ?? "?";
    if (line.side === "left") {
      entry.left.push(name);
      entry.amount += line.amount;
    } else {
      entry.right.push(name);
    }
    byTransaction.set(line.id, entry);
  }
  const dedupe = (names: string[]) => [...new Set(names)].join(" + ");
  const exportTransactions: ExportTransaction[] = [...byTransaction.values()].map((e) => ({
    date: e.date,
    title: e.title,
    memo: e.memo,
    flow: `${dedupe(e.left)} ← ${dedupe(e.right)}`,
    amount: money(e.amount),
  }));

  const file = buildAnalysisExport({
    generatedAt: now,
    currency: section.baseCurrency,
    timezone: section.timezone,
    currentMonth,
    year,
    overview,
    money,
    groupLabel: (group) => t(GROUP_LABEL_KEY[group as keyof typeof GROUP_LABEL_KEY]),
    accounts: catalog.map((a) => ({ name: a.name, group: a.group, category: a.category })),
    balances: balances.map((b) => ({
      group: b.group,
      name: b.name,
      amount: money(b.baseAmount),
    })),
    budgetNotes,
    formulas: exportFormulas,
    transactions: exportTransactions,
    transactionsFrom: txFrom,
    transactionsTo: now,
  });

  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // ASCII only: a Korean filename needs the RFC 5987 form and some
      // phone browsers still drop the file rather than decode it.
      "Content-Disposition": `attachment; filename="moneybook-analysis-${now}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
