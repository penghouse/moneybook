import { and, asc, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { addMonths, addYears, monthRange, today, yearMonthOf, yearOf, yearRange } from "@/lib/date";
import { activeDuring } from "@/lib/accounts";
import { parseBudgetPeriod } from "@/lib/budgets";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { getAccountFlows } from "@/lib/ledger";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { PeriodNav } from "../_components/period-nav";
import { SubmitButton } from "../_components/submit-button";
import { Card, Chip, controlClass, EmptyState, KeyValueRow, PageHeader } from "../_components/ui";
import { setBudgetAction } from "./actions";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { period: periodParam } = await searchParams;

  const now = today(section.timezone);
  const ref = parseBudgetPeriod(periodParam ?? "") ?? {
    period: "month" as const,
    periodKey: yearMonthOf(now),
  };
  const isYear = ref.period === "year";
  const { from, to } = isYear ? yearRange(ref.periodKey) : monthRange(ref.periodKey);

  const expenseAccounts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.sectionId, section.id),
      eq(accounts.group, "expense"),
      // Overlap with the period on screen, not with today — paging back
      // to March should budget against the accounts that existed in
      // March, including one closed since.
      activeDuring(from, to),
    ),
    orderBy: asc(accounts.sortOrder),
  });

  const periodBudgets = await db.query.budgets.findMany({
    where: and(
      eq(budgets.sectionId, section.id),
      eq(budgets.period, ref.period),
      eq(budgets.periodKey, ref.periodKey),
    ),
  });
  const budgetByAccountId = new Map(periodBudgets.map((b) => [b.accountId, b.amount]));

  // On the year screen, what each account's twelve months add up to.
  // This is the comparison the year budget exists for: a cap is only
  // useful next to the monthly plan it is supposed to contain.
  const monthlyByAccountId = new Map<string, number>();
  if (isYear) {
    const monthRows = await db.query.budgets.findMany({
      where: and(
        eq(budgets.sectionId, section.id),
        eq(budgets.period, "month"),
        like(budgets.periodKey, `${ref.periodKey}-%`),
      ),
    });
    for (const row of monthRows) {
      monthlyByAccountId.set(
        row.accountId,
        (monthlyByAccountId.get(row.accountId) ?? 0) + row.amount,
      );
    }
  }

  const flows = await getAccountFlows(db, { sectionId: section.id, from, to });
  const spentByAccountId = new Map(flows.map((f) => [f.accountId, f.baseAmount]));

  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);

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

  // Only meaningful on the year screen, where the whole point is whether
  // the totals fit inside the yearly caps.
  const totalBudget = expenseAccounts.reduce(
    (sum, a) => sum + (budgetByAccountId.get(a.id) ?? 0),
    0,
  );
  const totalMonthly = expenseAccounts.reduce(
    (sum, a) => sum + (monthlyByAccountId.get(a.id) ?? 0),
    0,
  );
  const totalSpent = expenseAccounts.reduce((sum, a) => sum + (spentByAccountId.get(a.id) ?? 0), 0);
  const hasAnyBudget = periodBudgets.length > 0;

  // Same shape as the income statement: rows under their category, with
  // the period's budget and spend summed on the heading.
  const hasCategories = expenseAccounts.some((a) => a.category);
  const categories = [
    ...new Map(
      expenseAccounts.map((a) => [a.category ?? null, a.category ?? null] as const),
    ).values(),
  ].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.budget")} />

      <PeriodNav
        prevHref={`/budget?period=${isYear ? addYears(ref.periodKey, -1) : addMonths(ref.periodKey, -1)}`}
        nextHref={`/budget?period=${isYear ? addYears(ref.periodKey, 1) : addMonths(ref.periodKey, 1)}`}
        label={ref.periodKey}
        prevLabel={isYear ? t("common.prevYear") : t("common.prevMonth")}
        nextLabel={isYear ? t("common.nextYear") : t("common.nextMonth")}
        units={units}
      />

      {isYear && expenseAccounts.length > 0 && (
        <Card>
          <KeyValueRow
            label={t("budget.yearTotal")}
            value={<span className="tnum font-semibold">{base(totalBudget)}</span>}
          />
          <KeyValueRow
            label={t("budget.monthlySum")}
            value={<span className="tnum font-semibold">{base(totalMonthly)}</span>}
            sub={
              hasAnyBudget && totalMonthly > totalBudget ? (
                <Chip tone="warning">
                  {t("budget.monthlySumOver")} {base(totalMonthly - totalBudget)}
                </Chip>
              ) : undefined
            }
          />
          <KeyValueRow
            label={t("budget.spent")}
            value={<span className="tnum font-semibold">{base(totalSpent)}</span>}
            sub={
              hasAnyBudget ? (
                totalSpent > totalBudget ? (
                  <Chip tone="negative">
                    {t("budget.over")} {base(totalSpent - totalBudget)}
                  </Chip>
                ) : (
                  <Chip>
                    {t("budget.remaining")} {base(totalBudget - totalSpent)}
                  </Chip>
                )
              ) : undefined
            }
          />
        </Card>
      )}

      <Card>
        {expenseAccounts.length === 0 ? (
          <EmptyState>{t("budget.empty")}</EmptyState>
        ) : (
          categories.map((category) => {
            const inCategory = expenseAccounts.filter((a) => (a.category ?? null) === category);
            const budgeted = inCategory.reduce(
              (sum, a) => sum + (budgetByAccountId.get(a.id) ?? 0),
              0,
            );
            const spentHere = inCategory.reduce(
              (sum, a) => sum + (spentByAccountId.get(a.id) ?? 0),
              0,
            );
            // A category with no budget anywhere under it has no share to
            // report — the same distinction an account row draws between
            // "no budget" and "a budget of zero", applied to a sum.
            const anyBudgetHere = inCategory.some((a) => budgetByAccountId.has(a.id));
            const percentHere = budgeted > 0 ? Math.round((spentHere / budgeted) * 100) : null;
            const overHere = anyBudgetHere && spentHere > budgeted;

            return (
              <div key={category ?? " uncategorized"}>
                {hasCategories && (
                  // The 상위 항목 band: the same figures its accounts show,
                  // one level up. Told apart from the rows it covers by the
                  // filled background, the heavier name, and those rows
                  // being indented under it — one signal could be read as
                  // decoration, three cannot.
                  <div
                    data-testid="budget-category"
                    className="bg-sunken border-rule-soft border-t px-4 py-2 first:border-t-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate text-sm font-bold">
                        {category ?? t("accounts.uncategorized")}
                      </span>
                      {anyBudgetHere &&
                        (overHere ? (
                          <Chip tone="negative">
                            {t("budget.over")} {base(spentHere - budgeted)}
                          </Chip>
                        ) : (
                          percentHere !== null && <Chip>{percentHere}%</Chip>
                        ))}
                      <span className="tnum text-ink-muted ml-auto text-xs font-semibold">
                        {base(spentHere)}
                        {anyBudgetHere && ` / ${base(budgeted)}`}
                      </span>
                    </div>
                    {anyBudgetHere && (
                      // Thinner than an account's bar: this one summarises
                      // those, and a heavier bar would read as the more
                      // important number.
                      <div className="bg-rule-soft mt-1.5 h-1 overflow-hidden rounded-full">
                        <div
                          className={`h-full rounded-full ${overHere ? "bg-negative" : "bg-accent"}`}
                          style={{
                            width: `${overHere ? 100 : Math.max(0, Math.min(100, percentHere ?? 0))}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {inCategory.map((account) => {
                  const budget = budgetByAccountId.get(account.id);
                  const spent = spentByAccountId.get(account.id) ?? 0;
                  const remaining = budget !== undefined ? budget - spent : null;
                  // `budget > 0`, not a truthiness check: a budget of exactly 0
                  // is a real setting ("spend nothing here"), and treating it as
                  // unset rendered a bare "(%)". Percent stays null only because
                  // a share of zero is undefined, not because the budget is.
                  const percent =
                    budget !== undefined && budget > 0 ? Math.round((spent / budget) * 100) : null;
                  const isOver = remaining !== null && remaining < 0;
                  const monthlySum = monthlyByAccountId.get(account.id) ?? 0;

                  return (
                    <div
                      key={account.id}
                      data-testid="budget-row"
                      className={`not-first:border-rule-soft py-3 not-first:border-t ${
                        // Indented under its 상위 항목, with a rule down the
                        // margin: the band above is a heading, not another
                        // row of the same list.
                        hasCategories ? "border-rule-soft mx-4 border-l pl-3" : "px-4"
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate font-semibold">{account.name}</span>
                        <span className="tnum text-ink-muted ml-auto text-sm">
                          {t("budget.spent")} {base(spent)}
                        </span>
                      </div>

                      {budget !== undefined && (
                        <>
                          <div className="bg-rule-soft my-2 h-1.5 overflow-hidden rounded-full">
                            <div
                              className={`h-full rounded-full ${isOver ? "bg-negative" : "bg-accent"}`}
                              // Clamped at both ends: a refund can make spend
                              // negative, and a zero budget that has been spent
                              // against is fully over rather than 0% used.
                              style={{
                                width: `${isOver ? 100 : Math.max(0, Math.min(100, percent ?? 0))}%`,
                              }}
                            />
                          </div>
                          <div className="text-ink-faint flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            <span className="tnum">
                              {t("budget.setBudget")} {base(budget)}
                              {percent !== null && ` (${percent}%)`}
                            </span>
                            <span
                              className={`tnum ml-auto ${isOver ? "text-negative font-semibold" : ""}`}
                            >
                              {isOver
                                ? `${t("budget.over")} ${base(-remaining)}`
                                : `${t("budget.remaining")} ${base(remaining ?? 0)}`}
                            </span>
                          </div>
                        </>
                      )}

                      {isYear && monthlySum > 0 && (
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                          <span className="text-ink-faint tnum">
                            {t("budget.monthlySum")} {base(monthlySum)}
                          </span>
                          {budget !== undefined && monthlySum > budget && (
                            <Chip tone="warning">
                              {t("budget.monthlySumOver")} {base(monthlySum - budget)}
                            </Chip>
                          )}
                        </div>
                      )}

                      <form
                        action={setBudgetAction}
                        className="mt-2 grid grid-cols-[1fr_auto] gap-2"
                      >
                        <input type="hidden" name="accountId" value={account.id} />
                        <input type="hidden" name="period" value={ref.periodKey} />
                        <input
                          type="number"
                          name="amount"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          aria-label={isYear ? t("budget.setYearBudget") : t("budget.setBudget")}
                          placeholder={budget === undefined ? t("budget.noBudget") : undefined}
                          defaultValue={
                            budget !== undefined
                              ? toMajorUnits(budget, section.baseCurrency)
                              : undefined
                          }
                          className={`${controlClass} tnum text-right`}
                        />
                        <SubmitButton variant="primary" pendingLabel={t("common.saving")}>
                          {t("common.save")}
                        </SubmitButton>
                      </form>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
