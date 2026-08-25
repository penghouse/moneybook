import { and, asc, desc, eq, exists, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import {
  ACCOUNT_GROUPS,
  accounts,
  transactionLines,
  transactions,
  type AccountGroup,
} from "@/db/schema";
import { interpolate } from "@/i18n/format";
import { GROUP_LABEL_KEY } from "@/i18n/groups";
import { parseGroupOrder } from "@/lib/account-groups";
import { byGroupOrder } from "@/lib/account-order";
import { activeOn, isFlowGroup } from "@/lib/accounts";
import { currentSection } from "@/lib/current-request";
import {
  addMonths,
  addYears,
  monthRange,
  rangeUnit,
  shiftWindow,
  today,
  yearMonthOf,
  yearOf,
  yearRange,
} from "@/lib/date";
import {
  findTaggedTransactionIds,
  getQuickEntries,
  getTitleTotals,
  getRunningBalances,
  getTitleSuggestions,
} from "@/lib/ledger";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { collectTags, normalizeTag } from "@/lib/tags";
import { CompositionChart } from "./_components/composition-chart";
import { DialogActionForm, RowDialog } from "./_components/dialog";
import { EntryForm, type EntryFormLabels } from "./_components/entry-form";
import { PeriodNav } from "./_components/period-nav";
import { RowEditor } from "./_components/row-editor";
import { SubmitButton } from "./_components/submit-button";
import { TransactionRowLinks } from "./_components/transaction-row-links";
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
    from?: string;
    to?: string;
    accountId?: string;
    q?: string;
    tag?: string;
  }>;
}) {
  const { section, t, locale } = await currentSection();
  const { from, to, accountId, q, tag: tagParam } = await searchParams;
  const tag = normalizeTag(tagParam);

  // Three reads that need nothing from each other, issued together: one
  // after another they were three network round trips on a deployment
  // where the database is not in this process.
  const [catalog, filterCatalog, suggestions, quickEntries] = await Promise.all([
    db.query.accounts.findMany({
      // The picker offers what can be posted to *now*; a closed account
      // stays out of it even though its past transactions still read and
      // edit normally.
      where: and(eq(accounts.sectionId, section.id), activeOn(today(section.timezone))),
      orderBy: asc(accounts.sortOrder),
    }),
    // The filter is about the past, so it lists every account — looking
    // up a closed card's history is exactly what it is for. Only the
    // entry form is restricted to what can be posted to today.
    db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
    }),
    // Deliberately not narrowed by whatever the list is filtered to, nor
    // by how far back it reaches: the suggestions are for what you are
    // about to type, not for what you are looking at.
    getTitleSuggestions(db, { sectionId: section.id }),
    // Read from the book rather than registered: it already knows that
    // 월세 moved between the same two accounts for the same figure six
    // months running, and asking the reader to write that down again in
    // a settings screen would be asking them to repeat themselves.
    getQuickEntries(db, {
      sectionId: section.id,
      currentMonth: yearMonthOf(today(section.timezone)),
    }),
  ]);

  // Both lists read in the book's own order — 분류 first, then the order
  // set on /accounts inside each. `sortOrder` alone is section-wide and
  // assigned as accounts are created, so it interleaves the 분류.
  const groupOrder = parseGroupOrder(section.groupOrder);
  const allAccounts = byGroupOrder(catalog, groupOrder);
  const filterAccounts = byGroupOrder(filterCatalog, groupOrder);

  const labels: EntryFormLabels = {
    blockedAccount: t("entry.blockedAccount"),
    blockedAmount: t("entry.blockedAmount"),
    blockedRate: t("entry.blockedRate"),
    blockedInactive: t("entry.blockedInactive"),
    blockedUnbalanced: t("entry.blockedUnbalanced"),
    quick: t("entry.quick"),
    quickDue: t("entry.quickDue"),
    rejectedUnbalanced: t("entry.unbalancedError"),
    rejectedAccountMissing: t("entry.accountMissingError"),
    rejectedAccountInactive: t("entry.accountInactiveError"),
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
    unconfirmed: t("entry.saveUnconfirmed"),
    groups: Object.fromEntries(ACCOUNT_GROUPS.map((g) => [g, t(GROUP_LABEL_KEY[g])])) as Record<
      AccountGroup,
      string
    >,
  };

  const conditions = [eq(transactions.sectionId, section.id)];
  if (from) conditions.push(gte(transactions.date, from));
  if (to) conditions.push(lte(transactions.date, to));
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(like(transactions.title, pattern), like(transactions.memo, pattern))!);
  }
  if (accountId) {
    // Correlated rather than a list of ids fetched first: an account with
    // ten thousand transactions on it would otherwise be read out in full
    // and posted back as a ten-thousand-term `IN (...)`. The subquery
    // stops at the first matching line and the statement stays one line
    // long however big the book gets.
    //
    // The outer query is already fenced to this section, which is what
    // keeps `accountId` — straight off the query string — from naming
    // somebody else's account and matching anything.
    //
    // Built with `exists()` rather than a raw sql`` template: this
    // condition is handed to db.query.transactions, and the relational
    // query builder rewrites every column it finds in a raw chunk to the
    // outer table's alias — which silently turned the subquery's own
    // `transaction_lines.transaction_id` into `transactions.transaction_id`
    // and made the statement fail to parse. A subquery built through the
    // builder keeps its own scope.
    conditions.push(
      exists(
        db
          .select({ one: transactionLines.id })
          .from(transactionLines)
          .where(
            and(
              eq(transactionLines.transactionId, transactions.id),
              eq(transactionLines.accountId, accountId),
            ),
          ),
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
  // Everything the list needs *about* the list, in one round trip.
  const [runningBalances, counterparties, titleShares] = await Promise.all([
    getRunningBalances(db, {
      sectionId: section.id,
      baseCurrency: section.baseCurrency,
      transactionIds: list.map((tx) => tx.id),
      account: filtered
        ? { id: filtered.id, group: filtered.group, currency: filtered.currency }
        : undefined,
      from: isFlow && from ? from : undefined,
    }),
    // 거래처관리 계정을 보고 있을 때만. Not bounded by the from/to filter
    // above it on purpose — see getTitleTotals: who still owes what is a
    // level, and reading it for August alone would report someone as
    // settled up because they happened not to pay this month.
    filtered?.tracksCounterparties
      ? getTitleTotals(db, {
          sectionId: section.id,
          accountId: filtered.id,
          group: filtered.group,
          from: filtered.activeFrom,
          to: today(section.timezone),
          untitledLabel: t("accounts.uncategorized"),
        })
      : [],
    /**
     * What the period's money on this account went on, by 적요.
     *
     * Not "how does 식비 compare with 교통비" — that is the income
     * statement, one screen back, and repeating it here would be the
     * same answer twice. The question this screen can answer and that
     * one cannot is what is *inside* the figure: 장보기 was two thirds
     * of August's 식비, 커피 was a tenth.
     *
     * Grouped without parentheses, exactly like the 거래처별 잔액 — 「점심」
     * and 「점심(회사 앞)」 are one line, or the biggest thing in the
     * account arrives split into halves that each look small.
     */
    filtered && from && to
      ? getTitleTotals(db, {
          sectionId: section.id,
          accountId: filtered.id,
          group: filtered.group,
          from,
          to,
          untitledLabel: t("accounts.uncategorized"),
        })
      : [],
  ]);
  const balanceByTransactionId = new Map(runningBalances.map((b) => [b.transactionId, b] as const));
  const balanceCaption = `${isFlow ? t("entry.runningTotal") : t("entry.balance")} · ${filtered ? filtered.name : t("assets.netWorth")}`;

  const counterpartyTotal = counterparties.reduce((sum, c) => sum + c.amount, 0);
  const showShares = counterpartyTotal > 0 && counterparties.every((c) => c.amount > 0);

  /**
   * Whether the 적요 figures can be drawn as shares of each other.
   *
   * A share is only defined over same-signed amounts, so a month with a
   * refund in it cannot have one — and a single 적요 is a bar filling
   * the width, which says "all of it" at the cost of a whole card.
   *
   * Both fall back to the figures rather than to nothing. Vanishing was
   * the complaint: the section was there in a busy month and gone in a
   * quiet one, which reads as the screen having lost something rather
   * than as the month having been simple.
   */
  const titleTotal = titleShares.reduce((sum, s) => sum + s.amount, 0);
  const showTitleShares =
    titleShares.length > 1 && titleTotal > 0 && titleShares.every((s) => s.amount > 0);

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

  /** The current filter, so a link out of the list can come back to it. */
  const listParams = new URLSearchParams(
    Object.entries({ from, to, accountId, q, tag }).filter(([, v]) => v) as [string, string][],
  );

  /**
   * Filtered to one account, this screen stops being the entry form and
   * becomes that account's ledger — which is how it is reached from the
   * balance sheet. So the filter opens instead of hiding behind a
   * disclosure, the period gets arrows, and the entry form steps aside:
   * nobody arriving from 자산현황 came here to type a new transaction.
   *
   */
  const isLedger = !!filtered;
  /**
   * Whether the list is reading a period at all.
   *
   * When it is, the bar owns it — arrows and a picker, the same control
   * 예산 / 자산현황 / the two charts use — and the filter carries the two
   * dates as hidden fields so applying a 계정 or a 태그 does not drop the
   * period underneath it. When it is not, the filter's own date boxes are
   * the only way to make one, so they stay.
   */
  const hasPeriod = !!(from && to);
  const listUnit = hasPeriod ? rangeUnit(from!, to!) : "custom";
  const periodHref = (range: { from: string; to: string }) => {
    const next = new URLSearchParams(listParams);
    next.set("from", range.from);
    next.set("to", range.to);
    return `/?${next}`;
  };
  // Built by hand rather than through periodHref: URLSearchParams
  // percent-encodes the braces, and the picker would then find no
  // placeholder to replace.
  const rangeTemplate = (() => {
    const rest = new URLSearchParams(listParams);
    rest.delete("from");
    rest.delete("to");
    const query = rest.toString();
    return `/?from={from}&to={to}${query ? `&${query}` : ""}`;
  })();
  // A whole month steps to the next whole month; anything else moves by
  // its own length, which is what the chart screens settled on — a fixed
  // month step across a ten-week window would leave most of it on screen
  // and make the press look like nothing happened.
  const listStep = (delta: number) =>
    periodHref(
      listUnit === "year"
        ? yearRange(addYears(yearOf(from!), delta))
        : listUnit === "month"
          ? monthRange(addMonths(yearMonthOf(from!), delta))
          : shiftWindow(from!, to!, delta),
    );

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

  /** The same filter with one parameter changed — used by the tag chips. */
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(listParams);
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    return query ? `/?${query}` : "/";
  };

  /** The period the list is reading, if it is filtered to one. */
  const listPeriod = from && to ? { from, to } : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title={isLedger ? filtered!.name : t("nav.entry")} />

      {!isLedger && (
        <div className="space-y-4">
          <EntryForm
            action={createTransactionAction}
            accounts={allAccounts}
            baseCurrency={section.baseCurrency}
            defaultDate={today(section.timezone)}
            locale={locale}
            labels={labels}
            suggestions={suggestions}
            quickEntries={quickEntries}
          />
        </div>
      )}

      {/* Above the filter, not below the summary: the period is the
          first thing a reader arriving from a report wants to move,
          and it used to sit past three cards where nobody found it. */}
      {hasPeriod && (
        <PeriodNav
          prevHref={listStep(-1)}
          nextHref={listStep(1)}
          label={
            listUnit === "year"
              ? yearOf(from!)
              : listUnit === "month"
                ? yearMonthOf(from!)
                : `${from} ~ ${to}`
          }
          prevLabel={listUnit === "year" ? t("common.prevYear") : t("common.prevMonth")}
          nextLabel={listUnit === "year" ? t("common.nextYear") : t("common.nextMonth")}
          jump={{
            kind: "range",
            from: from!,
            to: to!,
            hrefTemplate: rangeTemplate,
            label: t("common.pickRange"),
            fromLabel: t("entry.filterFrom"),
            toLabel: t("entry.filterTo"),
            confirmLabel: t("common.apply"),
            closeLabel: t("common.close"),
          }}
        />
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
              {hasPeriod ? (
                // Carried, not shown. The bar above is the period control
                // now, and two date boxes repeating it were the third
                // place on this screen that could change the same thing.
                <>
                  <input type="hidden" name="from" value={from} />
                  <input type="hidden" name="to" value={to} />
                </>
              ) : (
                <>
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
                    <input
                      type="date"
                      name="to"
                      defaultValue={to}
                      className={`${controlClass} tnum`}
                    />
                  </div>
                </>
              )}
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

        {titleShares.length > 0 && (
          <section className="mb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <SectionLabel>{t("entry.share")}</SectionLabel>
              <span className="tnum text-ink-faint text-xs">
                {formatMoney(titleTotal, filtered!.currency, locale)}
              </span>
            </div>
            <Card>
              {showTitleShares ? (
                <CompositionChart
                  slices={titleShares.map((s) => ({ id: s.name, name: s.name, amount: s.amount }))}
                  currency={filtered!.currency}
                  locale={locale}
                  shareLabel={t("entry.share")}
                />
              ) : (
                // The same fallback 거래처별 잔액 above already uses: every
                // 적요 is still named with its figure, which is what was
                // asked for — only the bar, which needs shares to be
                // meaningful, is left out.
                titleShares.map((share) => (
                  <KeyValueRow
                    key={share.name}
                    label={share.name}
                    value={
                      <Money amount={share.amount} currency={filtered!.currency} locale={locale} />
                    }
                  />
                ))
              )}
            </Card>
          </section>
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
                        </>
                      }
                    >
                      <RowEditor
                        editTitle={t("entry.editTitle")}
                        copyTitle={t("entry.duplicate")}
                        notice={t("entry.duplicateNotice")}
                        copyLabel={t("entry.duplicate")}
                        backLabel={t("entry.backToEdit")}
                        edit={
                          <EntryForm
                            action={updateTransactionAction}
                            accounts={pickerFor(tx.lines)}
                            baseCurrency={section.baseCurrency}
                            defaultDate={today(section.timezone)}
                            locale={locale}
                            labels={labels}
                            initial={{ transactionId: tx.id, ...prefillFrom(tx) }}
                            suggestions={suggestions}
                            quickEntries={quickEntries}
                          />
                        }
                        copy={
                          // The same values with no transactionId, which is
                          // the whole difference between updating this
                          // record and writing a new one.
                          <EntryForm
                            action={createTransactionAction}
                            accounts={pickerFor(tx.lines)}
                            baseCurrency={section.baseCurrency}
                            defaultDate={today(section.timezone)}
                            locale={locale}
                            labels={labels}
                            initial={prefillFrom(tx)}
                            suggestions={suggestions}
                            quickEntries={quickEntries}
                          />
                        }
                      >
                        <DialogActionForm action={deleteTransactionAction} className="ml-auto">
                          <input type="hidden" name="transactionId" value={tx.id} />
                          <SubmitButton variant="danger" pendingLabel={t("common.working")}>
                            {t("common.delete")}
                          </SubmitButton>
                        </DialogActionForm>
                      </RowEditor>
                    </RowDialog>

                    <TransactionRowLinks
                      date={tx.date}
                      memo={memoOf(tx)}
                      left={leftLines}
                      right={rightLines}
                      period={listPeriod}
                      tagHref={(tag) => withParam("tag", tag)}
                    />
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
