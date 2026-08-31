import { cookies } from "next/headers";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, formulas } from "@/db/schema";
import { foldCookieName, parseFolds, UNCATEGORIZED_FOLD } from "@/lib/category-folds";
import { currentSection } from "@/lib/current-request";
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
import { parseGroupOrder } from "@/lib/account-groups";
import { CategoryFold } from "../_components/category-fold";
import { PeriodNav } from "../_components/period-nav";
import { buildFormulaItems } from "@/lib/formula-items";
import { getAccountFlows } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { FormulaSection, formulaTotalLabels } from "../_components/formula-section";
import {
  buttonClass,
  Card,
  compactControlClass,
  EmptyState,
  KeyValueRow,
  Label,
  Money,
  PageHeader,
  SectionLabel,
} from "../_components/ui";

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const { from: fromParam, to: toParam } = await searchParams;

  const now = today(section.timezone);
  const defaultRange = monthRange(yearMonthOf(now));
  const from = fromParam ?? defaultRange.from;
  const to = toParam ?? defaultRange.to;

  // Month, year, or something hand-typed — read off the range itself, so
  // the unit on screen can never disagree with the dates it describes.
  const unit = rangeUnit(from, to);

  // The catalog, the period's flows and the saved formulas need nothing
  // from each other, so they go together rather than in single file.
  const [allAccounts, flows, formulaRows] = await Promise.all([
    db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
    }),
    getAccountFlows(db, { sectionId: section.id, from, to }),
    db.query.formulas.findMany({
      where: and(eq(formulas.sectionId, section.id), eq(formulas.scope, "income")),
      orderBy: asc(formulas.sortOrder),
    }),
  ]);
  const income = flows.filter((f) => f.group === "income");
  const expense = flows.filter((f) => f.group === "expense");
  const totalIncome = income.reduce((s, f) => s + f.baseAmount, 0);
  const totalExpense = expense.reduce((s, f) => s + f.baseAmount, 0);
  const netIncome = totalIncome - totalExpense;

  const shownYear = yearOf(from);

  /**
   * The 계산식 band's inputs, built from the same flows the statement
   * above prints — so a formula reads the period on screen rather than
   * some period of its own.
   */
  const formulaItems = buildFormulaItems({
    scope: "income",
    groupOrder: parseGroupOrder(section.groupOrder),
    accounts: allAccounts,
    amountByAccountId: new Map(flows.map((f) => [f.accountId, f.baseAmount])),
    labels: { totals: formulaTotalLabels("income", t) },
  });

  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);

  // "이번 달 먹는 데 얼마 썼나" is the question a flat account list
  // cannot answer once there are more than a handful of accounts, so the
  // rows sit under their category with a subtotal on the heading.
  const categoryOf = new Map(allAccounts.map((a) => [a.id, a.category ?? null] as const));

  function byCategory(list: typeof flows) {
    const map = new Map<string | null, typeof flows>();
    for (const f of list) {
      const key = categoryOf.get(f.accountId) ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0))
      .map(([category, rows]) => ({
        category,
        rows,
        subtotal: rows.reduce((s, f) => s + f.baseAmount, 0),
      }));
  }

  const hasCategories = allAccounts.some((a) => a.category);
  // Read here rather than restored on the client, so the page arrives
  // already folded instead of showing everything and collapsing after
  // hydration.
  const folded = parseFolds((await cookies()).get(foldCookieName("income"))?.value);

  function renderList(label: string, list: typeof flows) {
    return (
      <section key={label}>
        <SectionLabel>{label}</SectionLabel>
        <Card>
          {list.length === 0 ? (
            <EmptyState>{t("assets.empty")}</EmptyState>
          ) : (
            byCategory(list).map(({ category, rows, subtotal }) => {
              const body = rows.map((f) => (
                <KeyValueRow
                  key={f.accountId}
                  // The same move the budget rows make: "왜 이만큼이지"
                  // is answered by the transactions behind the figure,
                  // over exactly the period this statement is reading.
                  href={`/?accountId=${f.accountId}&from=${from}&to=${to}`}
                  label={f.name}
                  value={
                    <Money amount={f.baseAmount} currency={section.baseCurrency} locale={locale} />
                  }
                />
              ));
              return hasCategories ? (
                <CategoryFold
                  key={category ?? UNCATEGORIZED_FOLD}
                  scope="income"
                  name={category ?? UNCATEGORIZED_FOLD}
                  initialFolded={folded.includes(category ?? UNCATEGORIZED_FOLD)}
                  allFolded={folded}
                  testId="income-category"
                  band={
                    <span className="flex items-baseline gap-3">
                      <span className="text-ink-muted min-w-0 truncate text-xs font-semibold">
                        {category ?? t("accounts.uncategorized")}
                      </span>
                      <span className="tnum text-ink-muted ml-auto text-xs font-semibold">
                        {base(subtotal)}
                      </span>
                    </span>
                  }
                >
                  {body}
                </CategoryFold>
              ) : (
                <div key={category ?? UNCATEGORIZED_FOLD}>{body}</div>
              );
            })
          )}
        </Card>
      </section>
    );
  }

  const href = ({ from, to }: { from: string; to: string }) => `/income?from=${from}&to=${to}`;

  // The arrows step whole periods, which is what the labels say and what
  // this page defaults to. A hand-typed range that spans several months
  // therefore snaps to one when they are used — predictable, and the
  // range is still one 조회 away.
  const stepHref = (delta: number) =>
    href(
      unit === "year"
        ? yearRange(addYears(shownYear, delta))
        : monthRange(addMonths(yearMonthOf(from), delta)),
    );

  const units = [
    {
      label: t("common.unitMonth"),
      href: href(monthRange(yearMonthOf(from))),
      active: unit === "month",
    },
    { label: t("common.unitYear"), href: href(yearRange(shownYear)), active: unit === "year" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.income")}>
        <Link href={`/income/chart?to=${to}`} className={buttonClass("secondary")}>
          {t("assets.viewCharts")}
        </Link>
        <form
          // 조회 sat on its own line because two date boxes at their
          // natural width plus a button came to more than the row had.
          // The dates flex instead of standing at that width — but only
          // down to 8.5rem, because a date input clips rather than
          // wraps, and below that the year loses a digit. Under a width
          // where all three genuinely cannot fit, the button wraps,
          // which is the right thing to give up.
          className="flex flex-wrap items-end gap-2"
          action="/income"
        >
          <div className="min-w-[8.5rem] flex-1">
            <Label>{t("entry.filterFrom")}</Label>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className={`${compactControlClass} tnum`}
            />
          </div>
          <div className="min-w-[8.5rem] flex-1">
            <Label>{t("entry.filterTo")}</Label>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className={`${compactControlClass} tnum`}
            />
          </div>
          <button type="submit" className={`${buttonClass("secondary")} shrink-0`}>
            {t("common.apply")}
          </button>
        </form>
      </PageHeader>

      <PeriodNav
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        // The whole range for a custom one; just the period's own name
        // when it is exactly a month or a year, where "2026-08-01 ~
        // 2026-08-31" says nothing "2026-08" does not.
        label={
          unit === "custom" ? `${from} ~ ${to}` : unit === "year" ? shownYear : yearMonthOf(from)
        }
        prevLabel={unit === "year" ? t("common.prevYear") : t("common.prevMonth")}
        nextLabel={unit === "year" ? t("common.nextYear") : t("common.nextMonth")}
        shortPrev={t("common.prev")}
        shortNext={t("common.next")}
        units={units}
      />

      <Card>
        <div className="px-4 py-4">
          <div className="text-ink-faint text-xs tracking-wide">{t("income.netIncome")}</div>
          <div
            className={`tnum mt-1 mb-3.5 text-[2rem] leading-tight font-bold tracking-tighter ${
              netIncome > 0 ? "text-positive" : netIncome < 0 ? "text-negative" : ""
            }`}
          >
            {base(netIncome)}
          </div>
          <div className="text-ink-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              {t("income.totalIncome")}{" "}
              <b className="tnum text-ink font-semibold">{base(totalIncome)}</b>
            </span>
            <span>
              {t("income.totalExpense")}{" "}
              <b className="tnum text-ink font-semibold">{base(totalExpense)}</b>
            </span>
          </div>
        </div>
      </Card>

      {parseGroupOrder(section.groupOrder)
        .filter((g): g is "income" | "expense" => g === "income" || g === "expense")
        .map((group) =>
          group === "income"
            ? renderList(t("group.income"), income)
            : renderList(t("group.expense"), expense),
        )}

      <FormulaSection
        scope="income"
        rows={formulaRows}
        items={formulaItems}
        currency={section.baseCurrency}
        locale={locale}
        t={t}
      />
    </div>
  );
}
