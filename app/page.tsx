import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { accounts, transactionLines, transactions } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { interpolate } from "@/i18n/format";
import { activeOn, isFlowGroup } from "@/lib/accounts";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import {
  addMonths,
  addYears,
  monthRange,
  rangeUnit,
  today,
  yearMonthOf,
  yearOf,
  yearRange,
} from "@/lib/date";
import {
  findTaggedTransactionIds,
  getAccountFlows,
  getCounterpartyBalances,
  getRunningBalances,
  getTitleSuggestions,
} from "@/lib/ledger";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { collectTags, normalizeTag } from "@/lib/tags";
import { CompositionChart } from "./_components/composition-chart";
import { DialogActionForm, RowDialog } from "./_components/dialog";
import { EntryForm, type EntryFormLabels } from "./_components/entry-form";
import { PeriodNav } from "./_components/period-nav";
import { SubmitButton } from "./_components/submit-button";
import {
  buttonClass,
  Card,
  controlClass,
  EmptyState,
  Hint,
  KeyValueRow,
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
    tag?: string;
    duplicate?: string;
  }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const {
    error,
    name: errorAccountName,
    from,
    to,
    accountId,
    q,
    tag: tagParam,
    duplicate,
  } = await searchParams;
  const tag = normalizeTag(tagParam);

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

  // Deliberately not narrowed by whatever the list is filtered to, nor
  // by how far back it reaches: the suggestions are for what you are
  // about to type, not for what you are looking at.
  const suggestions = await getTitleSuggestions(db, { sectionId: section.id });

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
    saving: t("common.saving"),
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

  // Snapshotted before the tag narrows things: the tag chips are how you
  // find the other tags, so they are read from the period rather than
  // from what one of them has already filtered down to.
  const untaggedConditions = [...conditions];

  if (tag) {
    conditions.push(
      inArray(
        transactions.id,
        await findTaggedTransactionIds(db, { sectionId: section.id, tag, from, to }),
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
  // 식비 has no balance, only a period total — so on a flow account the
  // column is a running total *of the period on screen*, and it is
  // captioned as one. Read from the book's beginning it would be the
  // lifetime sum, a number arriving from 예산 nobody could use.
  const isFlow = !!filtered && isFlowGroup(filtered.group);
  const runningBalances = await getRunningBalances(db, {
    sectionId: section.id,
    baseCurrency: section.baseCurrency,
    transactionIds: list.map((tx) => tx.id),
    account: filtered
      ? { id: filtered.id, group: filtered.group, currency: filtered.currency }
      : undefined,
    from: isFlow && from ? from : undefined,
  });
  const balanceByTransactionId = new Map(runningBalances.map((b) => [b.transactionId, b] as const));
  const balanceCaption = `${isFlow ? t("entry.runningTotal") : t("entry.balance")} · ${filtered ? filtered.name : t("assets.netWorth")}`;

  // 거래처관리 계정을 보고 있을 때만. Not bounded by the from/to filter
  // above it on purpose — see getCounterpartyBalances: who still owes
  // what is a level, and reading it for August alone would report
  // someone as settled up because they happened not to pay this month.
  const counterparties = filtered?.tracksCounterparties
    ? await getCounterpartyBalances(db, {
        sectionId: section.id,
        accountId: filtered.id,
        group: filtered.group,
        from: filtered.activeFrom,
        asOf: today(section.timezone),
        untitledLabel: t("accounts.uncategorized"),
      })
    : [];
  const counterpartyTotal = counterparties.reduce((sum, c) => sum + c.amount, 0);
  const showShares = counterpartyTotal > 0 && counterparties.every((c) => c.amount > 0);

  /**
   * The entry form's picker offers what can be posted to *today*, but a
   * form prefilled from an old transaction must still be able to show
   * the accounts that transaction used — including one closed since.
   * Without this the box renders blank while its hidden id is intact,
   * which reads as data loss and submits something the user never saw.
   */
  function pickerFor(lines: { accountId: string }[]) {
    const missing = lines
      .map((l) => l.accountId)
      .filter((id) => !allAccounts.some((a) => a.id === id))
      .map((id) => filterAccounts.find((a) => a.id === id))
      .filter((a) => a !== undefined);
    return missing.length === 0 ? allAccounts : [...allAccounts, ...missing];
  }

  /** The transaction's values as form state — the same shape whether it is
   *  being edited in place or copied into a new one. */
  const prefillFrom = (tx: (typeof list)[number]) => ({
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
  });

  // Fetched by id rather than picked out of `list`: the source is
  // usually right there, but the list is filtered and capped at 100, and
  // a copy link that quietly does nothing once the row scrolls past the
  // limit is worse than one more query. Scoped to the section, so an id
  // naming someone else's transaction finds nothing.
  const source = duplicate
    ? await db.query.transactions.findFirst({
        where: and(eq(transactions.id, duplicate), eq(transactions.sectionId, section.id)),
        with: { lines: { with: { account: true }, orderBy: asc(transactionLines.lineOrder) } },
      })
    : undefined;
  const copy = source ? prefillFrom(source) : undefined;

  /** The current filter, so copying does not throw away the list you found it in. */
  const listParams = new URLSearchParams(
    Object.entries({ from, to, accountId, q, tag }).filter(([, v]) => v) as [string, string][],
  );
  const withoutDuplicate = listParams.toString();

  /**
   * Filtered to one account, this screen stops being the entry form and
   * becomes that account's ledger — which is how it is reached from the
   * balance sheet. So the filter opens instead of hiding behind a
   * disclosure, the period gets arrows, and the entry form steps aside:
   * nobody arriving from 자산현황 came here to type a new transaction.
   *
   * A copy in progress is the exception. It *is* something to type, and
   * hiding the form would leave 복제 doing nothing visible.
   */
  const isLedger = !!filtered && !copy;
  const ledgerUnit = from && to ? rangeUnit(from, to) : "custom";
  const ledgerStep = (delta: number) => {
    const range =
      ledgerUnit === "year"
        ? yearRange(addYears(yearOf(from!), delta))
        : monthRange(addMonths(yearMonthOf(from!), delta));
    const next = new URLSearchParams(listParams);
    next.set("from", range.from);
    next.set("to", range.to);
    return `/?${next}`;
  };

  /**
   * What this transaction has written on it, transaction memo first and
   * any line memos after — one line, so the list still reads as a list.
   * A split's per-line notes are often the only text it carries.
   */
  const memoOf = (tx: (typeof list)[number]) =>
    [tx.memo, ...tx.lines.map((l) => l.memo)].filter((m) => m?.trim()).join(" · ");

  /**
   * Which tags exist in the period on screen, so the chips can offer
   * them. Read from `untaggedConditions` — filtered down by a tag, the
   * list would only ever show the tag already chosen.
   */
  const knownTags = await db
    .select({ memo: transactions.memo, lineMemo: transactionLines.memo })
    .from(transactions)
    .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
    .where(and(...untaggedConditions))
    .then((rows) => [...new Set(rows.flatMap((r) => collectTags([r.memo, r.lineMemo])))].sort());

  /**
   * What the filter adds up to, and how many rows it matched.
   *
   * Computed with an aggregate over the same conditions rather than from
   * `list`, which stops at TRANSACTION_LIMIT — a 합계 that silently
   * ignored the hundred-and-first transaction would be worse than none.
   * Each transaction contributes its debit total, the number its own row
   * shows; for a transfer that is the amount moved, not new spending.
   */
  const filterTotal = tag
    ? (
        await db
          .select({
            total: sql<number>`coalesce(sum(case when ${transactionLines.side} = 'left' then ${transactionLines.baseAmount} else 0 end), 0)`,
            count: sql<number>`count(distinct ${transactions.id})`,
          })
          .from(transactions)
          .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
          .where(and(...conditions))
      )[0]
    : null;

  /**
   * Where the account on screen sits among its peers for this period.
   *
   * "식비 ₩420,000" answers how much; it does not answer whether that is
   * most of the month's spending or a rounding error next to rent. The
   * share is only defined against a like-for-like total, so the
   * comparison is the account's own group over the same dates — expenses
   * against expenses, never against income or against a transfer.
   *
   * Only for flow accounts, and only over a real period: a balance is a
   * level, and 「은행이 자산의 40%」 has nothing to do with the dates in
   * the filter above it.
   */
  const shares =
    isFlow && from && to
      ? (await getAccountFlows(db, { sectionId: section.id, from, to }))
          .filter((f) => f.group === filtered!.group && f.baseAmount > 0)
          .sort((a, b) => b.baseAmount - a.baseAmount)
          .map((f) => ({ id: f.accountId, name: f.name, amount: f.baseAmount }))
      : [];

  /** The same filter with one parameter changed — used by the tag chips. */
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(listParams);
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    return query ? `/?${query}` : "/";
  };

  const andMore = (n: number) => t("entry.andMore").replace("{n}", String(n));
  /** "식비 외 1" — the first account plus a count, so a split still reads
   *  as one line in the list. */
  const namesOf = (lines: { account: { name: string } }[]) =>
    lines.length <= 1
      ? (lines[0]?.account.name ?? "")
      : `${lines[0].account.name} ${andMore(lines.length - 1)}`;

  return (
    <div className="space-y-4">
      <PageHeader title={isLedger ? filtered!.name : t("nav.entry")} />

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

      {/* The 복제 links jump here; scroll-mt clears the sticky bar. */}
      {!isLedger && (
        <div id="entry" className="scroll-mt-20 space-y-4">
          {copy && (
            // The form below is prefilled and about to create a *second*
            // record, which is indistinguishable from an edit form unless
            // something says so.
            <div className="bg-sunken rounded-control flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm">
              <span>{t("entry.duplicateNotice")}</span>
              <Link
                href={withoutDuplicate ? `/?${withoutDuplicate}` : "/"}
                className={`${buttonClass("ghost")} ml-auto`}
              >
                {t("common.cancel")}
              </Link>
            </div>
          )}

          <EntryForm
            // Remounts when the copied transaction changes, so pressing 복제
            // on a second row replaces the prefill instead of leaving the
            // first one's state in place — the form holds its values in
            // useState, which a prop change alone does not reset.
            key={duplicate ?? "new"}
            action={createTransactionAction}
            accounts={copy ? pickerFor(copy.lines) : allAccounts}
            baseCurrency={section.baseCurrency}
            defaultDate={today(section.timezone)}
            locale={locale}
            labels={labels}
            initial={copy}
            suggestions={suggestions}
            afterSaveHref={copy ? (withoutDuplicate ? `/?${withoutDuplicate}` : "/") : undefined}
          />
        </div>
      )}

      {filtered?.tracksCounterparties && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <SectionLabel>{t("entry.counterparties")}</SectionLabel>
            <span className="tnum text-ink-faint text-xs">
              {formatMoney(counterpartyTotal, filtered.currency, locale)}
            </span>
          </div>
          <Card>
            {counterparties.length === 0 ? (
              <EmptyState>{t("entry.noCounterparties")}</EmptyState>
            ) : showShares ? (
              <CompositionChart
                slices={counterparties.map((c) => ({ id: c.name, name: c.name, amount: c.amount }))}
                currency={filtered.currency}
                locale={locale}
                shareLabel={t("entry.counterparties")}
              />
            ) : (
              // A share is only defined over same-signed amounts, and a
              // counterparty *can* sit the other way round — an
              // overpayment on a receivable. Rather than draw a bar whose
              // length lies, those fall back to a plain list: every
              // counterparty is still there with its balance, which is
              // what was asked for.
              counterparties.map((c) => (
                <KeyValueRow
                  key={c.name}
                  label={c.name}
                  value={<Money amount={c.amount} currency={filtered.currency} locale={locale} />}
                />
              ))
            )}
          </Card>
          <Hint>{t("entry.counterpartiesHint")}</Hint>
        </section>
      )}

      <section>
        {/* The balance column is a bare number without this — the reader
            would have to guess whether it is net worth or one account. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <SectionLabel>{t("entry.transactions")}</SectionLabel>
          {list.length > 0 && <span className="text-ink-faint text-xs">{balanceCaption}</span>}
        </div>

        <Card className="mb-3">
          {/* Open on an account's ledger: the filter *is* the controls of
              that screen, and a disclosure hiding them makes the period
              on show look like a fixed fact. */}
          <details open={isLedger}>
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
              <div className="min-w-0">
                <Label>{t("entry.filterTag")}</Label>
                <input
                  type="text"
                  name="tag"
                  defaultValue={tag ?? ""}
                  placeholder={t("entry.tagPlaceholder")}
                  className={controlClass}
                />
              </div>
              {knownTags.length > 0 && (
                <div className="col-span-2 flex flex-wrap gap-1.5 md:col-span-4">
                  {/* The tags on what is currently listed, as one tap each.
                      Written into memos as free text, so this is the only
                      place that can say which ones exist. */}
                  {knownTags.map((known) => (
                    <Link
                      key={known}
                      href={withParam("tag", known === tag ? null : known)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        known === tag
                          ? "border-accent bg-accent text-accent-ink"
                          : "bg-sunken text-ink-muted hover:bg-rule border-transparent"
                      }`}
                    >
                      #{known}
                    </Link>
                  ))}
                </div>
              )}
              <div className="col-span-2 grid grid-cols-[1fr_auto] gap-2 md:col-span-4 md:justify-end">
                <button type="submit" className={buttonClass("secondary", true)}>
                  {t("common.apply")}
                </button>
                <Link href="/" className={buttonClass("ghost")}>
                  {t("entry.filterClear")}
                </Link>
              </div>
            </form>
          </details>
        </Card>

        {filterTotal && (
          <Card className="mb-3">
            <KeyValueRow
              label={
                <span className="flex items-baseline gap-2">
                  <span className="font-semibold">#{tag}</span>
                  <span className="text-ink-faint text-xs">
                    {interpolate(t("entry.tagCount"), { n: String(filterTotal.count) })}
                  </span>
                </span>
              }
              value={
                <Money amount={filterTotal.total} currency={section.baseCurrency} locale={locale} />
              }
            />
          </Card>
        )}

        {shares.length > 1 && (
          <section className="mb-3">
            <SectionLabel>{t("entry.share")}</SectionLabel>
            <Card>
              <CompositionChart
                slices={shares}
                currency={section.baseCurrency}
                locale={locale}
                shareLabel={t("assets.share")}
                highlightId={filtered!.id}
              />
            </Card>
          </section>
        )}

        {isLedger && ledgerUnit !== "custom" && (
          <div className="mb-3">
            <PeriodNav
              prevHref={ledgerStep(-1)}
              nextHref={ledgerStep(1)}
              label={ledgerUnit === "year" ? yearOf(from!) : yearMonthOf(from!)}
              prevLabel={ledgerUnit === "year" ? t("common.prevYear") : t("common.prevMonth")}
              nextLabel={ledgerUnit === "year" ? t("common.nextYear") : t("common.nextMonth")}
            />
          </div>
        )}

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
                    <RowDialog
                      title={tx.title || tx.date}
                      closeLabel={t("common.close")}
                      trigger={
                        <>
                          <span className="flex items-baseline gap-2.5">
                            <span className="text-ink-faint tnum shrink-0 font-mono text-xs">
                              {tx.date.slice(5)}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-semibold">
                              {tx.title}
                            </span>
                            <span className="flex shrink-0 flex-col items-end">
                              <Money
                                amount={total}
                                currency={section.baseCurrency}
                                locale={locale}
                              />
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
                          {/* The memo was written on this transaction and
                              then only ever visible by opening it. A row
                              that hides what you typed is a row you have
                              to open to trust. */}
                          {memoOf(tx) && (
                            <span className="text-ink-faint mt-0.5 block truncate text-xs">
                              {memoOf(tx)}
                            </span>
                          )}
                        </>
                      }
                    >
                      <div className="space-y-3">
                        <EntryForm
                          action={updateTransactionAction}
                          accounts={pickerFor(tx.lines)}
                          baseCurrency={section.baseCurrency}
                          defaultDate={today(section.timezone)}
                          locale={locale}
                          labels={labels}
                          initial={{ transactionId: tx.id, ...prefillFrom(tx) }}
                          suggestions={suggestions}
                        />
                        <div className="flex flex-wrap gap-2">
                          {/* 복제 is navigation, not a mutation: it opens the
                              entry form at the top of the page carrying this
                              transaction's values, so every field can be
                              checked and changed before anything is written.
                              The hash is what saves a scroll back up on a
                              phone. */}
                          <Link
                            href={`/?${new URLSearchParams({ ...Object.fromEntries(listParams), duplicate: tx.id })}#entry`}
                            className={buttonClass("secondary")}
                          >
                            {t("entry.duplicate")}
                          </Link>
                          <DialogActionForm action={deleteTransactionAction} className="ml-auto">
                            <input type="hidden" name="transactionId" value={tx.id} />
                            <SubmitButton variant="danger" pendingLabel={t("common.working")}>
                              {t("common.delete")}
                            </SubmitButton>
                          </DialogActionForm>
                        </div>
                      </div>
                    </RowDialog>
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
