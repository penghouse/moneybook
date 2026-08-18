"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  accounts,
  budgets,
  exchangeRates,
  transactionLines,
  transactions,
  type AccountGroup,
} from "@/db/schema";
import { interpolate } from "@/i18n/format";
import { formatCsvFormatError, formatImportIssue } from "@/i18n/csv-errors";
import { parseAccountsCsv, parseBudgetsCsv, parseRatesCsv, parseTransactionsCsv } from "@/lib/csv";
import {
  checkAccountRow,
  checkBudgetRow,
  checkRateRow,
  checkTransactionGroup,
  groupTransactionRows,
} from "@/lib/csv-import";
import { toMinorUnits } from "@/lib/money";
import { checkPairedRow, parsePairedCsv, planPairedAccounts } from "@/lib/paired-csv";
import { checkPeriodBudgetRow, parsePeriodBudgetCsv } from "@/lib/period-budget-csv";
import { parseBudgetPeriod } from "@/lib/budgets";
import { currentSection } from "@/lib/current-request";
import type { ImportState } from "./csv-types";

/**
 * Import is a single form submitted twice: once to preview, once (via a
 * `commit` submit button) to actually write. The file input stays
 * mounted between the two, so the browser re-sends the same file rather
 * than the page round-tripping the whole CSV back through a hidden
 * field — which would have made a large backup cross the Server Action
 * body limit twice instead of once.
 */

const MAX_REPORTED_ISSUES = 50;

async function readCsv(formData: FormData): Promise<string | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return file.text();
}

function isCommit(formData: FormData): boolean {
  return formData.get("commit") === "1";
}

/**
 * A libSQL statement binds every value as a parameter and caps how many
 * one statement may carry, so a multi-row insert of a whole ledger has
 * to be split. Both numbers land near 3,000 parameters per statement —
 * transactions bind 6 columns a row, lines 10 — which is well under the
 * limit while keeping round trips down to tens rather than thousands.
 * A five-year export is ~8,700 transactions, and inserting them
 * one at a time is exactly what makes an import that size time out.
 */
const TX_CHUNK_ROWS = 500;
const LINE_CHUNK_ROWS = 300;
/** Budgets and rates, both five columns a row. */
const UPSERT_CHUNK_ROWS = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function revalidateAll() {
  for (const path of ["/", "/assets", "/income", "/budget", "/accounts", "/settings"]) {
    revalidatePath(path);
  }
}

// ---- Accounts ----

export async function importAccountsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { section, t } = await currentSection();

  const csvText = await readCsv(formData);
  if (csvText === null) return { status: "error", message: t("csv.noFile") };

  let rows;
  try {
    rows = parseAccountsCsv(csvText);
  } catch (error) {
    return { status: "error", message: formatCsvFormatError(t, error) };
  }

  const existing = await db.query.accounts.findMany({ where: eq(accounts.sectionId, section.id) });
  const existingNames = new Set(existing.map((a) => a.name));
  const seenInFile = new Set<string>();
  // Section-wide, matching how createAccountAction assigns sort order,
  // so imported accounts don't collide with manually created ones.
  let nextSortOrder = existing.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1;

  const toInsert: (typeof accounts.$inferInsert)[] = [];
  const issues: { label: string; message: string }[] = [];
  let existingCount = 0;

  for (const row of rows) {
    const check = checkAccountRow(row, existingNames, seenInFile);
    if (check.status === "error") {
      issues.push({ label: check.name || "?", message: formatImportIssue(t, check.issue!) });
      continue;
    }
    seenInFile.add(check.name);
    if (check.status === "existing") {
      existingCount++;
      continue;
    }
    toInsert.push({
      sectionId: section.id,
      group: row.group as AccountGroup,
      name: check.name,
      currency: row.currency.trim().toUpperCase(),
      sortOrder: nextSortOrder++,
      activeFrom: check.activeFrom ?? null,
      activeTo: check.activeTo ?? null,
      memo: row.memo.trim() || null,
      category: row.category.trim() || null,
      tracksCounterparties: check.tracksCounterparties,
    });
  }

  const counts = [
    { label: t("csv.new"), value: toInsert.length },
    { label: t("csv.existing"), value: existingCount },
    { label: t("csv.errors"), value: issues.length },
  ];

  if (!isCommit(formData)) {
    return {
      status: "preview",
      counts,
      issues: issues.slice(0, MAX_REPORTED_ISSUES),
      canCommit: toInsert.length > 0,
    };
  }

  if (toInsert.length > 0) await db.insert(accounts).values(toInsert);
  revalidateAll();
  return {
    status: "done",
    message: t("csv.done"),
    counts: [
      { label: t("csv.created"), value: toInsert.length },
      { label: t("csv.skipped"), value: existingCount + issues.length },
    ],
  };
}

// ---- Transactions ----

export async function importTransactionsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { section, t } = await currentSection();

  const csvText = await readCsv(formData);
  if (csvText === null) return { status: "error", message: t("csv.noFile") };

  let rows;
  try {
    rows = parseTransactionsCsv(csvText);
  } catch (error) {
    return { status: "error", message: formatCsvFormatError(t, error) };
  }

  const groups = groupTransactionRows(rows);
  const accountRows = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
  });
  const accountsByName = new Map(
    accountRows.map((a) => [a.name, { id: a.id, currency: a.currency }]),
  );

  const valid: Extract<ReturnType<typeof checkTransactionGroup>, { ok: true }>[] = [];
  const issues: { label: string; message: string }[] = [];
  for (const group of groups) {
    const result = checkTransactionGroup(group, accountsByName, section.baseCurrency);
    if (result.ok) valid.push(result);
    else issues.push({ label: group.key, message: formatImportIssue(t, result.issue) });
  }

  if (!isCommit(formData)) {
    return {
      status: "preview",
      counts: [
        { label: t("csv.total"), value: groups.length },
        { label: t("csv.importableTransactions"), value: valid.length },
        { label: t("csv.errors"), value: issues.length },
      ],
      issues: issues.slice(0, MAX_REPORTED_ISSUES),
      canCommit: valid.length > 0,
    };
  }

  // Ids minted here rather than read back from `returning()`, which is
  // what let this become two batched statements instead of two round
  // trips per transaction — the same shape importPairedAction uses, and
  // for the same reason: restoring a backup of a few thousand rows was
  // otherwise thousands of round trips inside one open transaction.
  const txValues: (typeof transactions.$inferInsert)[] = [];
  const lineValues: (typeof transactionLines.$inferInsert)[] = [];
  for (const result of valid) {
    const id = crypto.randomUUID();
    txValues.push({
      id,
      sectionId: section.id,
      date: result.date,
      title: result.title,
      memo: result.memo || null,
      kind: result.kind,
    });
    for (const [i, line] of result.lines.entries()) {
      lineValues.push({
        transactionId: id,
        lineOrder: i,
        side: line.side,
        accountId: line.accountId,
        currency: line.currency,
        amount: line.amount,
        rate: line.rate,
        baseAmount: line.baseAmount,
        memo: line.memo,
      });
    }
  }

  await db.transaction(async (tx) => {
    for (const part of chunk(txValues, TX_CHUNK_ROWS)) await tx.insert(transactions).values(part);
    for (const part of chunk(lineValues, LINE_CHUNK_ROWS)) {
      await tx.insert(transactionLines).values(part);
    }
  });

  revalidateAll();
  return {
    status: "done",
    message: t("csv.done"),
    counts: [
      { label: t("csv.created"), value: valid.length },
      { label: t("csv.skipped"), value: issues.length },
    ],
  };
}

// ---- Paired-row CSV ----

export async function importPairedAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { section, t } = await currentSection();

  const csvText = await readCsv(formData);
  if (csvText === null) return { status: "error", message: t("csv.noFile") };

  let rows;
  try {
    rows = parsePairedCsv(csvText);
  } catch (error) {
    return { status: "error", message: formatCsvFormatError(t, error) };
  }

  const issues: { label: string; message: string }[] = [];
  const valid: Extract<ReturnType<typeof checkPairedRow>, { ok: true }>[] = [];
  for (const row of rows) {
    const check = checkPairedRow(row, section.baseCurrency);
    if (check.ok) {
      valid.push(check);
    } else {
      issues.push({
        label: interpolate(t("csv.rowLabel"), { n: check.line }),
        message: formatImportIssue(t, check.issue),
      });
    }
  }

  const existingRows = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
  });
  const existingByName = new Map(
    existingRows.map((a) => [a.name, { id: a.id, group: a.group, currency: a.currency }]),
  );
  const plans = planPairedAccounts(
    valid.flatMap((v) => [v.left, v.right]),
    existingByName,
    section.baseCurrency,
  );

  // An account this book cannot write to takes every row mentioning it
  // down with it — reported once, against the account, rather than once
  // per row.
  const unusable = new Set<string>();
  for (const plan of plans) {
    if (plan.status !== "conflict") continue;
    unusable.add(plan.name);
    issues.push({ label: plan.name, message: formatImportIssue(t, plan.issue) });
  }
  const importable = valid.filter((v) => !unusable.has(v.left.name) && !unusable.has(v.right.name));
  const newAccounts = plans.filter((p) => p.status === "new");

  if (!isCommit(formData)) {
    return {
      status: "preview",
      counts: [
        { label: t("csv.total"), value: rows.length },
        { label: t("csv.newAccounts"), value: newAccounts.length },
        { label: t("csv.importableTransactions"), value: importable.length },
        { label: t("csv.skipped"), value: rows.length - importable.length },
      ],
      issues: issues.slice(0, MAX_REPORTED_ISSUES),
      canCommit: importable.length > 0,
    };
  }

  // Section-wide, matching how createAccountAction assigns sort order.
  let nextSortOrder = existingRows.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1;

  // An account's window opens on the day it was first posted to. That is
  // a fact the file states, and it keeps a card opened in 2024 out of a
  // 2022 budget without anyone filling in a form 66 times. The closing
  // end is left open on purpose: the last transaction on an account you
  // still use is also in the past, so deriving `activeTo` from it would
  // retire every account in the book.
  const firstUse = new Map<string, string>();
  for (const row of importable) {
    for (const name of [row.left.name, row.right.name]) {
      const seen = firstUse.get(name);
      if (seen === undefined || row.date < seen) firstUse.set(name, row.date);
    }
  }

  const accountValues = newAccounts.map((plan) => ({
    id: crypto.randomUUID(),
    sectionId: section.id,
    group: plan.group,
    name: plan.name,
    currency: section.baseCurrency,
    sortOrder: nextSortOrder++,
    activeFrom: firstUse.get(plan.name) ?? null,
  }));

  const idByName = new Map(existingRows.map((a) => [a.name, a.id]));
  for (const account of accountValues) idByName.set(account.name, account.id);

  // Ids are generated here rather than read back from `.returning()`:
  // every line needs its transaction's id, and asking the database for
  // 8,700 of them one at a time is the entire cost of the import.
  const txValues: (typeof transactions.$inferInsert)[] = [];
  const lineValues: (typeof transactionLines.$inferInsert)[] = [];
  for (const row of importable) {
    const id = crypto.randomUUID();
    txValues.push({
      id,
      sectionId: section.id,
      date: row.date,
      title: row.title,
      memo: row.memo || null,
      kind: "normal",
    });
    const shared = {
      transactionId: id,
      currency: section.baseCurrency,
      amount: row.amount,
      rate: 1,
      baseAmount: row.amount,
      memo: null,
    };
    lineValues.push(
      { ...shared, lineOrder: 0, side: "left" as const, accountId: idByName.get(row.left.name)! },
      { ...shared, lineOrder: 1, side: "right" as const, accountId: idByName.get(row.right.name)! },
    );
  }

  // One transaction for the whole file: a half-written import of several
  // thousand rows is much harder to recover from than a failed one.
  await db.transaction(async (tx) => {
    if (accountValues.length > 0) await tx.insert(accounts).values(accountValues);
    for (const part of chunk(txValues, TX_CHUNK_ROWS)) await tx.insert(transactions).values(part);
    for (const part of chunk(lineValues, LINE_CHUNK_ROWS)) {
      await tx.insert(transactionLines).values(part);
    }
  });

  revalidateAll();
  return {
    status: "done",
    message: t("csv.done"),
    counts: [
      { label: t("csv.created"), value: txValues.length },
      { label: t("csv.newAccounts"), value: accountValues.length },
      { label: t("csv.skipped"), value: rows.length - txValues.length },
    ],
  };
}

// ---- Budgets ----

export async function importBudgetsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { section, t } = await currentSection();

  const csvText = await readCsv(formData);
  if (csvText === null) return { status: "error", message: t("csv.noFile") };

  let rows;
  try {
    rows = parseBudgetsCsv(csvText);
  } catch (error) {
    return { status: "error", message: formatCsvFormatError(t, error) };
  }

  const accountRows = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
  });
  const accountsByName = new Map(
    accountRows.map((a) => [a.name, { id: a.id, currency: a.currency }]),
  );

  const valid = [];
  const issues: { label: string; message: string }[] = [];
  for (const row of rows) {
    const check = checkBudgetRow(row, accountsByName);
    if (check.ok) valid.push(check);
    else issues.push({ label: check.label, message: formatImportIssue(t, check.issue) });
  }

  if (!isCommit(formData)) {
    return {
      status: "preview",
      counts: [
        { label: t("csv.total"), value: rows.length },
        { label: t("csv.importableBudgets"), value: valid.length },
        { label: t("csv.errors"), value: issues.length },
      ],
      issues: issues.slice(0, MAX_REPORTED_ISSUES),
      canCommit: valid.length > 0,
    };
  }

  // Deduped on the unique key, last row winning, which is what writing
  // them one at a time amounted to — and is also what keeps a file that
  // names the same budget twice from upserting a row against itself
  // inside a single statement.
  const budgetValues = [
    ...new Map(
      valid.map((row) => [
        `${row.accountId}|${row.period}|${row.periodKey}`,
        {
          sectionId: section.id,
          accountId: row.accountId,
          period: row.period,
          periodKey: row.periodKey,
          amount: toMinorUnits(row.amountMajor, section.baseCurrency),
        },
      ]),
    ).values(),
  ];

  await db.transaction(async (tx) => {
    for (const part of chunk(budgetValues, UPSERT_CHUNK_ROWS)) {
      await tx
        .insert(budgets)
        .values(part)
        .onConflictDoUpdate({
          target: [budgets.accountId, budgets.period, budgets.periodKey],
          // `excluded` is the row that lost the conflict, so each row in
          // the batch updates with its own amount. A literal here would
          // give every conflicting row the same one.
          set: { amount: sql`excluded.amount` },
        });
    }
  });

  revalidateAll();
  return {
    status: "done",
    message: t("csv.done"),
    counts: [
      { label: t("csv.updated"), value: valid.length },
      { label: t("csv.skipped"), value: issues.length },
    ],
  };
}

// ---- Exchange rates ----

/**
 * The same budgets, arriving as another app's budget-vs-actual report.
 *
 * Unlike every other importer here, most of a valid file is *not*
 * imported: the format interleaves running totals and 상위 그룹 sums
 * with the account rows, and only the account rows have anywhere to go.
 * So skipped rows are counted separately from errors and the item names
 * are listed — 「이 줄들은 안 들어갔습니다」 is the one thing a reader
 * needs to check before committing.
 */
export async function importPeriodBudgetsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { section, t } = await currentSection();

  const csvText = await readCsv(formData);
  if (csvText === null) return { status: "error", message: t("csv.noFile") };

  let rows;
  try {
    rows = parsePeriodBudgetCsv(csvText);
  } catch (error) {
    return { status: "error", message: formatCsvFormatError(t, error) };
  }

  const accountRows = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
    columns: { id: true, name: true, group: true },
  });
  const accountsByGroupAndName = new Map(accountRows.map((a) => [`${a.group} ${a.name}`, a.id]));

  const valid = [];
  const issues: { label: string; message: string }[] = [];
  // Named once each, however many periods the file covers them for: a
  // year's export repeats every subtotal twelve times, and a list of
  // twelve identical 「총」 helps nobody.
  const skippedItems = new Set<string>();
  for (const row of rows) {
    const check = checkPeriodBudgetRow(row, section.baseCurrency, accountsByGroupAndName);
    if (check.ok) valid.push(check);
    else if (check.skipped) skippedItems.add(check.item);
    else issues.push({ label: check.label, message: formatImportIssue(t, check.issue) });
  }

  if (!isCommit(formData)) {
    return {
      status: "preview",
      counts: [
        { label: t("csv.total"), value: rows.length },
        { label: t("csv.importableBudgets"), value: valid.length },
        { label: t("csv.skipped"), value: rows.length - valid.length - issues.length },
        { label: t("csv.errors"), value: issues.length },
      ],
      issues: [
        ...[...skippedItems].map((item) => ({
          label: item,
          message: t("csv.notAnAccount"),
        })),
        ...issues,
      ].slice(0, MAX_REPORTED_ISSUES),
      canCommit: valid.length > 0,
    };
  }

  // Deduped on the unique key, last row winning — the same rule the
  // other budget importer follows, and what keeps a file naming one
  // budget twice from upserting a row against itself in one statement.
  const budgetValues = [
    ...new Map(
      valid.map((row) => {
        const ref = parseBudgetPeriod(row.periodKey)!;
        return [
          `${row.accountId}|${ref.period}|${ref.periodKey}`,
          {
            sectionId: section.id,
            accountId: row.accountId,
            period: ref.period,
            periodKey: ref.periodKey,
            amount: row.amount,
          },
        ];
      }),
    ).values(),
  ];

  await db.transaction(async (tx) => {
    for (const part of chunk(budgetValues, UPSERT_CHUNK_ROWS)) {
      await tx
        .insert(budgets)
        .values(part)
        .onConflictDoUpdate({
          target: [budgets.accountId, budgets.period, budgets.periodKey],
          set: { amount: sql`excluded.amount` },
        });
    }
  });

  revalidateAll();
  return {
    status: "done",
    message: t("csv.done"),
    counts: [
      { label: t("csv.updated"), value: budgetValues.length },
      { label: t("csv.skipped"), value: rows.length - valid.length },
    ],
  };
}

export async function importRatesAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { t } = await currentSection();

  const csvText = await readCsv(formData);
  if (csvText === null) return { status: "error", message: t("csv.noFile") };

  let rows;
  try {
    rows = parseRatesCsv(csvText);
  } catch (error) {
    return { status: "error", message: formatCsvFormatError(t, error) };
  }

  const valid = [];
  const issues: { label: string; message: string }[] = [];
  for (const row of rows) {
    const check = checkRateRow(row);
    if (check.ok) valid.push(check);
    else issues.push({ label: check.label, message: formatImportIssue(t, check.issue) });
  }

  if (!isCommit(formData)) {
    return {
      status: "preview",
      counts: [
        { label: t("csv.total"), value: rows.length },
        { label: t("csv.importableRates"), value: valid.length },
        { label: t("csv.errors"), value: issues.length },
      ],
      issues: issues.slice(0, MAX_REPORTED_ISSUES),
      canCommit: valid.length > 0,
    };
  }

  const rateValues = [
    ...new Map(
      valid.map((row) => [
        `${row.date} ${row.base} ${row.quote}`,
        { date: row.date, base: row.base, quote: row.quote, rate: row.rate, source: row.source },
      ]),
    ).values(),
  ];

  await db.transaction(async (tx) => {
    for (const part of chunk(rateValues, UPSERT_CHUNK_ROWS)) {
      await tx
        .insert(exchangeRates)
        .values(part)
        .onConflictDoUpdate({
          target: [exchangeRates.date, exchangeRates.base, exchangeRates.quote],
          set: { rate: sql`excluded.rate`, source: sql`excluded.source` },
        });
    }
  });

  revalidateAll();
  return {
    status: "done",
    message: t("csv.done"),
    counts: [
      { label: t("csv.updated"), value: valid.length },
      { label: t("csv.skipped"), value: issues.length },
    ],
  };
}
