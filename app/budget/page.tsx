import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { addMonths, monthRange, today, yearMonthOf } from "@/lib/date";
import { activeDuring } from "@/lib/accounts";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { getAccountFlows } from "@/lib/ledger";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { SubmitButton } from "../_components/submit-button";
import { buttonClass, Card, controlClass, EmptyState, PageHeader } from "../_components/ui";
import { setBudgetAction } from "./actions";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ yearMonth?: string }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { yearMonth: yearMonthParam } = await searchParams;
  const yearMonth = yearMonthParam ?? yearMonthOf(today(section.timezone));
  const { from, to } = monthRange(yearMonth);

  const expenseAccounts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.sectionId, section.id),
      eq(accounts.group, "expense"),
      // Overlap with the month on screen, not with today — paging back
      // to March should budget against the accounts that existed in
      // March, including one closed since.
      activeDuring(from, to),
    ),
    orderBy: asc(accounts.sortOrder),
  });

  const monthBudgets = await db.query.budgets.findMany({
    where: and(eq(budgets.sectionId, section.id), eq(budgets.yearMonth, yearMonth)),
  });
  const budgetByAccountId = new Map(monthBudgets.map((b) => [b.accountId, b.amount]));

  const flows = await getAccountFlows(db, { sectionId: section.id, from, to });
  const spentByAccountId = new Map(flows.map((f) => [f.accountId, f.baseAmount]));

  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);

  // Same shape as the income statement: rows under their category, with
  // the month's budget and spend summed on the heading.
  const hasCategories = expenseAccounts.some((a) => a.category);
  const categories = [
    ...new Map(
      expenseAccounts.map((a) => [a.category ?? null, a.category ?? null] as const),
    ).values(),
  ].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.budget")} />

      <Card>
        <div className="flex items-center px-1 py-1">
          <Link
            href={`/budget?yearMonth=${addMonths(yearMonth, -1)}`}
            className={buttonClass("ghost")}
          >
            ← {t("budget.prevMonth")}
          </Link>
          <span className="tnum mx-auto font-semibold">{yearMonth}</span>
          <Link
            href={`/budget?yearMonth=${addMonths(yearMonth, 1)}`}
            className={buttonClass("ghost")}
          >
            {t("budget.nextMonth")} →
          </Link>
        </div>
      </Card>

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
            return (
              <div key={category ?? " uncategorized"}>
                {hasCategories && (
                  <div className="bg-sunken border-rule-soft flex items-baseline gap-3 border-t px-4 py-1.5 first:border-t-0">
                    <span className="text-ink-muted min-w-0 truncate text-xs font-semibold">
                      {category ?? t("accounts.uncategorized")}
                    </span>
                    <span className="tnum text-ink-muted ml-auto text-xs font-semibold">
                      {base(spentHere)} / {base(budgeted)}
                    </span>
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

                  return (
                    <div
                      key={account.id}
                      data-testid="budget-row"
                      className="not-first:border-rule-soft px-4 py-3 not-first:border-t"
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

                      <form
                        action={setBudgetAction}
                        className="mt-2 grid grid-cols-[1fr_auto] gap-2"
                      >
                        <input type="hidden" name="accountId" value={account.id} />
                        <input type="hidden" name="yearMonth" value={yearMonth} />
                        <input
                          type="number"
                          name="amount"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          aria-label={t("budget.setBudget")}
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
