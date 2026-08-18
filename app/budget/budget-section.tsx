import Link from "next/link";
import type { Account, AccountGroup } from "@/db/schema";
import type { TranslationKey } from "@/i18n";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { Card, Chip, SectionLabel } from "../_components/ui";
import { setBudgetAction } from "./actions";
import { BudgetField } from "./budget-field";

/**
 * One side of the budget — 수입 or 지출 — as a total band, a band per
 * 상위 항목, and a row per account.
 *
 * Both sides read the same way and the only thing that differs is what
 * "over" means: spending more than planned is the thing the page exists
 * to warn about, while earning more than planned is the best news on the
 * screen. So the direction is a parameter and everything else is shared,
 * rather than the whole list existing twice with two colours in it.
 */
export function BudgetSection({
  group,
  accounts,
  budgetByAccountId,
  actualByAccountId,
  monthlyByAccountId,
  isYear,
  periodKey,
  from,
  to,
  currency,
  locale,
  t,
}: {
  group: Extract<AccountGroup, "income" | "expense">;
  accounts: readonly Account[];
  budgetByAccountId: ReadonlyMap<string, number>;
  actualByAccountId: ReadonlyMap<string, number>;
  /** Year view only: what the twelve monthly budgets add up to. */
  monthlyByAccountId: ReadonlyMap<string, number>;
  isYear: boolean;
  periodKey: string;
  from: string;
  to: string;
  currency: string;
  locale: string;
  t: (key: TranslationKey) => string;
}) {
  const base = (minor: number) => formatMoney(minor, currency, locale);
  const income = group === "income";
  // Earning past the plan is good news and spending past it is not, so
  // the same arithmetic wears opposite colours on the two sides.
  const overTone = income ? "positive" : "negative";
  const overBar = income ? "bg-positive" : "bg-negative";
  const actualLabel = t(income ? "budget.earned" : "budget.spent");
  const leftLabel = t(income ? "budget.toGo" : "budget.remaining");

  if (accounts.length === 0) return null;

  const totalBudget = accounts.reduce((sum, a) => sum + (budgetByAccountId.get(a.id) ?? 0), 0);
  const totalActual = accounts.reduce((sum, a) => sum + (actualByAccountId.get(a.id) ?? 0), 0);
  const totalMonthly = accounts.reduce((sum, a) => sum + (monthlyByAccountId.get(a.id) ?? 0), 0);
  const anyBudget = accounts.some((a) => budgetByAccountId.has(a.id));
  const percentAll = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : null;
  const overAll = anyBudget && totalActual > totalBudget;

  const hasCategories = accounts.some((a) => a.category);
  const categories = [
    ...new Map(accounts.map((a) => [a.category ?? null, a.category ?? null] as const)).values(),
  ].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));

  return (
    <section>
      <SectionLabel>{t(income ? "budget.incomeSide" : "budget.expenseSide")}</SectionLabel>

      <Card>
        {/* 전체: the same shape as a 상위 항목 band and an account row,
            one level further up — largest name, thickest bar. Three
            levels of the same reading, each told from the next by weight
            rather than by wording. */}
        <div data-testid={`budget-total-${group}`} className="px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-base font-bold">{t("budget.grandTotal")}</span>
            {anyBudget &&
              (overAll ? (
                <Chip tone={overTone}>
                  {t("budget.over")} {base(totalActual - totalBudget)}
                </Chip>
              ) : (
                percentAll !== null && <Chip>{percentAll}%</Chip>
              ))}
            <span className="tnum ml-auto font-semibold">
              {/* Paired with a budget, `실적 / 예산` reads off the bar
                  below it. Standing alone the figure has nothing to be
                  read against, so it says what it is. */}
              {!anyBudget && <span className="font-normal">{actualLabel} </span>}
              {base(totalActual)}
              {anyBudget && ` / ${base(totalBudget)}`}
            </span>
          </div>
          {anyBudget && (
            <div className="bg-rule-soft mt-2 h-2.5 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full ${overAll ? overBar : "bg-accent"}`}
                style={{ width: `${overAll ? 100 : Math.max(0, Math.min(100, percentAll ?? 0))}%` }}
              />
            </div>
          )}
          {isYear && totalMonthly > 0 && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
              <span className="text-ink-faint tnum">
                {t("budget.monthlySum")} {base(totalMonthly)}
              </span>
              {anyBudget && totalMonthly > totalBudget && (
                <Chip tone="warning">
                  {t("budget.monthlySumOver")} {base(totalMonthly - totalBudget)}
                </Chip>
              )}
            </div>
          )}
        </div>

        {categories.map((category) => {
          const inCategory = accounts.filter((a) => (a.category ?? null) === category);
          const budgeted = inCategory.reduce(
            (sum, a) => sum + (budgetByAccountId.get(a.id) ?? 0),
            0,
          );
          const actualHere = inCategory.reduce(
            (sum, a) => sum + (actualByAccountId.get(a.id) ?? 0),
            0,
          );
          // A category with no budget anywhere under it has no share to
          // report — the same distinction an account row draws between
          // "no budget" and "a budget of zero", applied to a sum.
          const anyBudgetHere = inCategory.some((a) => budgetByAccountId.has(a.id));
          const percentHere = budgeted > 0 ? Math.round((actualHere / budgeted) * 100) : null;
          const overHere = anyBudgetHere && actualHere > budgeted;

          return (
            <div key={category ?? " uncategorized"}>
              {hasCategories && (
                // The 상위 항목 band. Told apart from the rows it covers
                // by the filled background, the heavier name, and those
                // rows being indented under it — one signal could be read
                // as decoration, three cannot.
                <div
                  data-testid="budget-category"
                  className="bg-sunken border-rule-soft border-t px-4 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-sm font-bold">
                      {category ?? t("accounts.uncategorized")}
                    </span>
                    {anyBudgetHere &&
                      (overHere ? (
                        <Chip tone={overTone}>
                          {t("budget.over")} {base(actualHere - budgeted)}
                        </Chip>
                      ) : (
                        percentHere !== null && <Chip>{percentHere}%</Chip>
                      ))}
                    <span className="tnum text-ink-muted ml-auto text-xs font-semibold">
                      {!anyBudgetHere && <span className="font-normal">{actualLabel} </span>}
                      {base(actualHere)}
                      {anyBudgetHere && ` / ${base(budgeted)}`}
                    </span>
                  </div>
                  {anyBudgetHere && (
                    // Thinner than an account's bar: this one summarises
                    // those, and a heavier bar would read as the more
                    // important number.
                    <div className="bg-rule-soft mt-1.5 h-1 overflow-hidden rounded-full">
                      <div
                        className={`h-full rounded-full ${overHere ? overBar : "bg-accent"}`}
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
                const actual = actualByAccountId.get(account.id) ?? 0;
                const left = budget !== undefined ? budget - actual : null;
                // `budget > 0`, not a truthiness check: a budget of exactly 0
                // is a real setting ("spend nothing here"), and treating it as
                // unset rendered a bare "(%)". Percent stays null only because
                // a share of zero is undefined, not because the budget is.
                const percent =
                  budget !== undefined && budget > 0 ? Math.round((actual / budget) * 100) : null;
                const isOver = left !== null && left < 0;
                const monthlySum = monthlyByAccountId.get(account.id) ?? 0;

                return (
                  <div
                    key={account.id}
                    data-testid="budget-row"
                    className={`border-rule-soft border-t py-3 ${
                      // Indented under its 상위 항목, with a rule down the
                      // margin: the band above is a heading, not another
                      // row of the same list.
                      hasCategories ? "border-rule-soft mx-4 border-l pl-3" : "px-4"
                    }`}
                  >
                    {/* "이 지출이 뭐였지" is answered by the transactions
                        behind it, so the name and the figure together open
                        the period on screen filtered to this account. The
                        whole line rather than the name alone: a name is a
                        24px target on a page tapped with a thumb, and the
                        amount is the half people reach for. */}
                    <Link
                      href={`/?accountId=${account.id}&from=${from}&to=${to}`}
                      className="hover:bg-sunken rounded-control -mx-2 flex min-h-11 items-center px-2"
                    >
                      <span className="flex w-full items-baseline gap-2">
                        <span className="min-w-0 truncate font-semibold">{account.name}</span>
                        <span className="tnum text-ink-muted ml-auto text-sm">
                          {actualLabel} {base(actual)}
                        </span>
                      </span>
                    </Link>

                    {budget !== undefined && (
                      <div className="bg-rule-soft my-2 h-1.5 overflow-hidden rounded-full">
                        <div
                          className={`h-full rounded-full ${isOver ? overBar : "bg-accent"}`}
                          // Clamped at both ends: a refund can make spend
                          // negative, and a zero budget that has been spent
                          // against is fully over rather than 0% used.
                          style={{
                            width: `${isOver ? 100 : Math.max(0, Math.min(100, percent ?? 0))}%`,
                          }}
                        />
                      </div>
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

                    {/* The figures ride inside the field so a settled row
                        can fold the box away behind 수정 and still say
                        what it is set to. */}
                    <BudgetField
                      action={setBudgetAction}
                      accountId={account.id}
                      period={periodKey}
                      amountMajor={
                        budget !== undefined ? toMajorUnits(budget, currency) : undefined
                      }
                      labels={{
                        field: t(isYear ? "budget.setYearBudget" : "budget.setBudget"),
                        edit: t("common.edit"),
                        cancel: t("common.cancel"),
                        save: t("common.save"),
                        saving: t("common.saving"),
                        noBudget: t("budget.noBudget"),
                      }}
                    >
                      {budget !== undefined && (
                        <div className="text-ink-faint flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span className="tnum">
                            {t("budget.setBudget")} {base(budget)}
                            {percent !== null && ` (${percent}%)`}
                          </span>
                          <span
                            className={`tnum ml-auto ${isOver && !income ? "text-negative font-semibold" : ""}`}
                          >
                            {isOver
                              ? `${t("budget.over")} ${base(-left)}`
                              : `${leftLabel} ${base(left ?? 0)}`}
                          </span>
                        </div>
                      )}
                    </BudgetField>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
