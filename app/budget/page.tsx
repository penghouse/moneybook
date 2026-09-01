import { cookies } from "next/headers";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { foldCookieName, parseFolds } from "@/lib/category-folds";
import { currentSection } from "@/lib/current-request";
import { addMonths, addYears, monthRange, today, yearMonthOf, yearOf, yearRange } from "@/lib/date";
import { activeDuring } from "@/lib/accounts";
import { monthsCoverYear } from "@/lib/budget-coverage";
import { parseBudgetPeriod } from "@/lib/budgets";
import { getAccountFlows } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { PeriodNav } from "../_components/period-nav";
import { Card, EmptyState, Hint, Money, PageHeader } from "../_components/ui";
import { BudgetSection } from "./budget-section";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const { period: periodParam } = await searchParams;

  const now = today(section.timezone);
  const ref = parseBudgetPeriod(periodParam ?? "") ?? {
    period: "month" as const,
    periodKey: yearMonthOf(now),
  };
  const isYear = ref.period === "year";
  const { from, to } = isYear ? yearRange(ref.periodKey) : monthRange(ref.periodKey);

  const [catalog, periodBudgets, flows] = await Promise.all([
    db.query.accounts.findMany({
      where: and(
        eq(accounts.sectionId, section.id),
        // Both sides now. 저축 is 수입 − 지출, and a page that only
        // planned the spending could never say what was meant to be
        // left over — which is the figure the roadmap runs on.
        inArray(accounts.group, ["income", "expense"]),
        // Overlap with the period on screen, not with today — paging
        // back to March should budget against the accounts that existed
        // in March, including one closed since.
        activeDuring(from, to),
      ),
      orderBy: asc(accounts.sortOrder),
    }),
    db.query.budgets.findMany({
      where: and(
        eq(budgets.sectionId, section.id),
        eq(budgets.period, ref.period),
        eq(budgets.periodKey, ref.periodKey),
      ),
    }),
    getAccountFlows(db, { sectionId: section.id, from, to }),
  ]);
  const budgetByAccountId = new Map(periodBudgets.map((b) => [b.accountId, b.amount]));
  const actualByAccountId = new Map(flows.map((f) => [f.accountId, f.baseAmount]));

  // On the year screen, what each account's twelve months add up to.
  // This is the comparison the year budget exists for: a cap is only
  // useful next to the monthly plan it is supposed to contain.
  const monthlyByAccountId = new Map<string, number>();
  /**
   * Accounts whose year budget is the twelve months underneath it.
   *
   * The screen used to ask for a year's cap even where every month
   * already had one — an empty box and a 저장 button sitting over a
   * figure the book had worked out already. Where the months cover the
   * year the sum stands in for the cap, and it stands in *everywhere*:
   * the row, the 상위 항목 band, the section total and the 저축 line all
   * read from this one map, so none of them can disagree about what is
   * budgeted.
   *
   * A real year budget still wins. This fills a hole; it overrules
   * nothing anyone typed.
   */
  const derivedYearIds = new Set<string>();
  if (isYear) {
    const monthRows = await db.query.budgets.findMany({
      where: and(
        eq(budgets.sectionId, section.id),
        eq(budgets.period, "month"),
        like(budgets.periodKey, `${ref.periodKey}-%`),
      ),
    });
    const monthsByAccountId = new Map<string, Set<string>>();
    for (const row of monthRows) {
      monthlyByAccountId.set(
        row.accountId,
        (monthlyByAccountId.get(row.accountId) ?? 0) + row.amount,
      );
      const seen = monthsByAccountId.get(row.accountId) ?? new Set<string>();
      seen.add(row.periodKey);
      monthsByAccountId.set(row.accountId, seen);
    }

    for (const account of catalog) {
      if (budgetByAccountId.has(account.id)) continue;
      const budgeted = monthsByAccountId.get(account.id);
      if (!budgeted || !monthsCoverYear({ year: ref.periodKey, account, budgeted })) continue;
      budgetByAccountId.set(account.id, monthlyByAccountId.get(account.id) ?? 0);
      derivedYearIds.add(account.id);
    }
  }

  const incomeAccounts = catalog.filter((a) => a.group === "income");
  const expenseAccounts = catalog.filter((a) => a.group === "expense");

  const sum = (list: typeof catalog, source: ReadonlyMap<string, number>) =>
    list.reduce((total, a) => total + (source.get(a.id) ?? 0), 0);

  // 저축 both ways: what the plan leaves over, and what actually stayed.
  const plannedSaving =
    sum(incomeAccounts, budgetByAccountId) - sum(expenseAccounts, budgetByAccountId);
  const actualSaving =
    sum(incomeAccounts, actualByAccountId) - sum(expenseAccounts, actualByAccountId);
  const hasAnyBudget = periodBudgets.length > 0;

  const year = yearOf(from);
  // Switching to months from a year lands on that year's current month
  // where there is one, and on January otherwise — never on a month you
  // have to page forward eleven times to leave.
  const monthKey = isYear
    ? year === yearOf(now)
      ? yearMonthOf(now)
      : `${year}-01`
    : ref.periodKey;
  const units = [
    { label: t("common.unitMonth"), href: `/budget?period=${monthKey}`, active: !isYear },
    { label: t("common.unitYear"), href: `/budget?period=${year}`, active: isYear },
  ];

  const shared = {
    budgetByAccountId,
    actualByAccountId,
    monthlyByAccountId,
    isYear,
    derivedYearIds,
    // Read here rather than restored on the client, so the page arrives
    // already folded instead of showing every item and collapsing after
    // hydration — and so the folds survive 이전 달 / 다음 달.
    folded: parseFolds((await cookies()).get(foldCookieName("budget"))?.value),
    periodKey: ref.periodKey,
    from,
    to,
    currency: section.baseCurrency,
    locale,
    t,
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.budget")} />

      <PeriodNav
        prevHref={`/budget?period=${isYear ? addYears(ref.periodKey, -1) : addMonths(ref.periodKey, -1)}`}
        nextHref={`/budget?period=${isYear ? addYears(ref.periodKey, 1) : addMonths(ref.periodKey, 1)}`}
        label={ref.periodKey}
        prevLabel={isYear ? t("common.prevYear") : t("common.prevMonth")}
        nextLabel={isYear ? t("common.nextYear") : t("common.nextMonth")}
        shortPrev={t("common.prev")}
        shortNext={t("common.next")}
        units={units}
        // Stepping one month at a time is right for "how did last month
        // go" and eight taps too many for "what did I budget in
        // January", so the label opens a picker.
        jump={{
          kind: "period",
          unit: ref.period,
          hrefTemplate: "/budget?period={value}",
          label: t(isYear ? "budget.pickYear" : "budget.pickMonth"),
        }}
      />

      {catalog.length === 0 ? (
        <Card>
          <EmptyState>{t("budget.empty")}</EmptyState>
        </Card>
      ) : (
        <>
          {/* 저축 sits at the top because it is the answer the other two
              lists are working towards, and because it is the figure the
              roadmap reads this screen for. */}
          <Card>
            <div data-testid="budget-saving" className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-base font-bold">{t("budget.saving")}</span>
                <Money
                  amount={actualSaving}
                  currency={section.baseCurrency}
                  locale={locale}
                  tone="signed"
                  showPlus
                  className="ml-auto text-base"
                />
              </div>
              {hasAnyBudget && (
                <div className="text-ink-faint flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span>{t("budget.savingPlanned")}</span>
                  <span className="tnum ml-auto">
                    {formatMoney(plannedSaving, section.baseCurrency, locale)}
                  </span>
                </div>
              )}
            </div>
          </Card>
          <Hint>{t("budget.savingHint")}</Hint>

          <BudgetSection group="income" accounts={incomeAccounts} {...shared} />
          <BudgetSection group="expense" accounts={expenseAccounts} {...shared} />
        </>
      )}
    </div>
  );
}
