import { and, asc, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { accounts, transactionLines, transactions } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { interpolate } from "@/i18n/format";
import { activeOn } from "@/lib/accounts";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { today } from "@/lib/date";
import { getRunningBalances } from "@/lib/ledger";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { EntryForm, type EntryFormLabels } from "./_components/entry-form";
import {
  buttonClass,
  Card,
  controlClass,
  EmptyState,
  Label,
  Money,
  PageHeader,
  SectionLabel,
} from "./_components/ui";
import {
  createTransactionAction,
  deleteTransactionAction,
  updateTransactionAction,
} from "./entry-actions";

const TRANSACTION_LIMIT = 100;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    name?: string;
    from?: string;
    to?: string;
    accountId?: string;
    q?: string;
  }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { error, name: errorAccountName, from, to, accountId, q } = await searchParams;

  const allAccounts = await db.query.accounts.findMany({
    // The picker offers what can be posted to *now*; a closed account
    // stays out of it even though its past transactions still read and
    // edit normally.
    where: and(eq(accounts.sectionId, section.id), activeOn(today(section.timezone))),
    orderBy: asc(accounts.sortOrder),
  });

  // The filter is about the past, so it lists every account — looking up
  // a closed card's history is exactly what it is for. Only the entry
  // form is restricted to what can be posted to today.
  const filterAccounts = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
    orderBy: asc(accounts.sortOrder),
  });

  const labels: EntryFormLabels = {
    date: t("common.date"),
    title: t("common.title"),
    memo: t("common.memo"),
    details: t("entry.details"),
    amount: t("common.amount"),
    rate: t("entry.rate"),
    left: t("side.left"),
    right: t("side.right"),
    leftHint: t("side.left.hint"),
    rightHint: t("side.right.hint"),
    split: t("entry.split"),
    swap: t("entry.swap"),
    addLine: t("entry.addLine"),
    removeLine: t("common.delete"),
    save: t("common.save"),
    balanced: t("entry.balanced"),
    unbalanced: t("entry.unbalanced"),
    difference: t("entry.difference"),
    namePlaceholder: t("entry.searchPlaceholder"),
  };

  const conditions = [eq(transactions.sectionId, section.id)];
  if (from) conditions.push(gte(transactions.date, from));
  if (to) conditions.push(lte(transactions.date, to));
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(like(transactions.title, pattern), like(transactions.memo, pattern))!);
  }
  if (accountId) {
    // accountId comes straight from the query string, so the join is
    // constrained to this section's own transactions — otherwise this
    // reads every line of whichever account the caller names.
    const matches = await db
      .select({ transactionId: transactionLines.transactionId })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(
        and(eq(transactionLines.accountId, accountId), eq(transactions.sectionId, section.id)),
      );
    conditions.push(
      inArray(
        transactions.id,
        matches.map((m) => m.transactionId),
      ),
    );
  }

  const list = await db.query.transactions.findMany({
    where: and(...conditions),
    // `id` last: two transactions sharing a date and timestamp must be
    // ordered the same here and in the running-balance window, or the
    // balance column reads as though it runs backwards.
    orderBy: [desc(transactions.date), desc(transactions.createdAt), desc(transactions.id)],
    limit: TRANSACTION_LIMIT,
    with: {
      lines: {
        with: { account: true },
        orderBy: asc(transactionLines.lineOrder),
      },
    },
  });

  // Filtering to one account changes what "the balance" means: that
  // account's own balance, in its own currency, instead of net worth.
  const filtered = accountId ? filterAccounts.find((a) => a.id === accountId) : undefined;
  const runningBalances = await getRunningBalances(db, {
    sectionId: section.id,
    baseCurrency: section.baseCurrency,
    transactionIds: list.map((tx) => tx.id),
    account: filtered
      ? { id: filtered.id, group: filtered.group, currency: filtered.currency }
      : undefined,
  });
  const balanceByTransactionId = new Map(runningBalances.map((b) => [b.transactionId, b] as const));
  const balanceCaption = `${t("entry.balance")} · ${filtered ? filtered.name : t("assets.netWorth")}`;

  const andMore = (n: number) => t("entry.andMore").replace("{n}", String(n));
  /** "식비 외 1" — the first account plus a count, so a split still reads
   *  as one line in the list. */
  const namesOf = (lines: { account: { name: string } }[]) =>
    lines.length <= 1
      ? (lines[0]?.account.name ?? "")
      : `${lines[0].account.name} ${andMore(lines.length - 1)}`;

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.entry")} />

      {error === "unbalanced" && (
        <p className="bg-negative-soft text-negative rounded-control px-3 py-2 text-sm">
          {t("entry.unbalancedError")}
        </p>
      )}
      {error === "account_inactive" && (
        <p className="bg-negative-soft text-negative rounded-control px-3 py-2 text-sm">
          {interpolate(t("entry.accountInactiveError"), { name: errorAccountName ?? "" })}
        </p>
      )}

      <EntryForm
        action={createTransactionAction}
        accounts={allAccounts}
        baseCurrency={section.baseCurrency}
        defaultDate={today(section.timezone)}
        locale={locale}
        labels={labels}
      />

      <section>
        {/* The balance column is a bare number without this — the reader
            would have to guess whether it is net worth or one account. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <SectionLabel>{t("entry.transactions")}</SectionLabel>
          {list.length > 0 && <span className="text-ink-faint text-xs">{balanceCaption}</span>}
        </div>

        <Card className="mb-3">
          <details>
            <summary className="text-ink-muted flex min-h-11 cursor-pointer items-center px-4 text-sm">
              {t("entry.filters")}
            </summary>
            <form
              className="border-rule-soft grid grid-cols-2 gap-3 border-t px-4 py-3 md:grid-cols-4"
              action="/"
            >
              <div className="min-w-0">
                <Label>{t("entry.filterFrom")}</Label>
                <input
                  type="date"
                  name="from"
                  defaultValue={from}
                  className={`${controlClass} tnum`}
                />
              </div>
              <div className="min-w-0">
                <Label>{t("entry.filterTo")}</Label>
                <input type="date" name="to" defaultValue={to} className={`${controlClass} tnum`} />
              </div>
              <div className="min-w-0">
                <Label>{t("entry.filterAccount")}</Label>
                <select name="accountId" defaultValue={accountId ?? ""} className={controlClass}>
                  <option value="">{t("entry.allAccounts")}</option>
                  {filterAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <Label>{t("entry.filterSearch")}</Label>
                <input type="text" name="q" defaultValue={q} className={controlClass} />
              </div>
              <div className="col-span-2 grid grid-cols-[1fr_auto] gap-2 md:col-span-4 md:justify-end">
                <button type="submit" className={buttonClass("secondary", true)}>
                  {t("entry.filterApply")}
                </button>
                <Link href="/" className={buttonClass("ghost")}>
                  {t("entry.filterClear")}
                </Link>
              </div>
            </form>
          </details>
        </Card>

        <Card>
          {list.length === 0 ? (
            <EmptyState>{t("entry.noTransactions")}</EmptyState>
          ) : (
            <ul>
              {list.map((tx) => {
                const leftLines = tx.lines.filter((l) => l.side === "left");
                const rightLines = tx.lines.filter((l) => l.side === "right");
                // The transaction's size is one number — the debit total in
                // base currency — rather than every leg spelled out, which
                // is what made the old single-line summary unreadable.
                const total = leftLines.reduce((sum, l) => sum + l.baseAmount, 0);
                const balance = balanceByTransactionId.get(tx.id);

                return (
                  <li key={tx.id} className="not-first:border-rule-soft not-first:border-t">
                    <details className="group">
                      {/* list-none: the summary holds two block lines, so
                          the default disclosure triangle would sit on a
                          line of its own above them. */}
                      <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <span className="flex items-baseline gap-2.5">
                          <span className="text-ink-faint tnum shrink-0 font-mono text-xs">
                            {tx.date.slice(5)}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-semibold">{tx.title}</span>
                          <span className="flex shrink-0 flex-col items-end">
                            <Money amount={total} currency={section.baseCurrency} locale={locale} />
                            {balance && (
                              <span className="tnum text-ink-faint text-xs">
                                {formatMoney(balance.amount, balance.currency, locale)}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="text-ink-muted mt-0.5 flex items-center gap-1.5 text-sm">
                          <span className="min-w-0 truncate">{namesOf(leftLines)}</span>
                          <span className="text-ink-faint shrink-0">←</span>
                          <span className="min-w-0 truncate">{namesOf(rightLines)}</span>
                        </span>
                      </summary>

                      <div className="border-rule-soft space-y-3 border-t px-4 py-3">
                        <EntryForm
                          action={updateTransactionAction}
                          accounts={allAccounts}
                          baseCurrency={section.baseCurrency}
                          defaultDate={today(section.timezone)}
                          locale={locale}
                          labels={labels}
                          initial={{
                            transactionId: tx.id,
                            date: tx.date,
                            title: tx.title,
                            memo: tx.memo ?? "",
                            lines: tx.lines.map((l) => ({
                              side: l.side,
                              accountId: l.accountId,
                              currency: l.currency,
                              amountMajor: toMajorUnits(l.amount, l.currency),
                              rate: l.rate,
                              memo: l.memo ?? "",
                            })),
                          }}
                        />
                        <form action={deleteTransactionAction}>
                          <input type="hidden" name="transactionId" value={tx.id} />
                          <button type="submit" className={buttonClass("danger")}>
                            {t("common.delete")}
                          </button>
                        </form>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
