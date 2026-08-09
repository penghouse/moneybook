import Link from "next/link";
import type { FormulaScope } from "@/db/schema";
import type { TranslationKey } from "@/i18n";
import type { FormulaItem } from "@/lib/formula-items";
import { formulaValues } from "@/lib/formula-items";
import { evaluateFormula, parseTerms } from "@/lib/formulas";
import { formatMoney } from "@/lib/money";
import { buttonClass, Card, EmptyState, Hint, SectionLabel } from "./ui";

type Translate = (key: TranslationKey) => string;

/**
 * What each report calls its own totals, so a formula's terms are named
 * on screen the way the screen names them.
 */
export function formulaTotalLabels(scope: FormulaScope, t: Translate): Record<string, string> {
  return scope === "assets"
    ? {
        assets: t("assets.totalAssets"),
        liabilities: t("assets.totalLiabilities"),
        netWorth: t("assets.netWorth"),
      }
    : {
        income: t("income.totalIncome"),
        expense: t("income.totalExpense"),
        netIncome: t("income.netIncome"),
      };
}

export interface FormulaRow {
  id: string;
  name: string;
  terms: string;
  expression: string;
}

/**
 * The 계산식 band at the foot of a report.
 *
 * Deliberately last on the page and visually quieter than the statement
 * above it: these are figures the book does not keep, worked out from
 * ones it does, and letting them sit among the real totals would blur
 * which is which.
 */
export function FormulaSection({
  scope,
  rows,
  items,
  currency,
  locale,
  t,
}: {
  scope: FormulaScope;
  rows: readonly FormulaRow[];
  items: readonly FormulaItem[];
  currency: string;
  locale: string;
  t: Translate;
}) {
  const values = { byKey: formulaValues(items) };
  const manageHref = `/formulas?scope=${scope}`;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>{t("formula.section")}</SectionLabel>
        <Link href={manageHref} className={`${buttonClass("ghost")} mb-1`}>
          {rows.length === 0 ? t("formula.add") : t("formula.manage")}
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState>{t("formula.empty")}</EmptyState>
        ) : (
          rows.map((row) => {
            const outcome = evaluateFormula(
              { terms: parseTerms(row.terms), expression: row.expression },
              values,
              currency,
            );
            return (
              <div
                key={row.id}
                data-testid="formula-result"
                className="not-first:border-rule-soft flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 not-first:border-t"
              >
                <span className="min-w-0 font-semibold break-keep">{row.name}</span>
                <span className="tnum ml-auto font-semibold">
                  {outcome.ok ? (
                    formatMoney(outcome.amount, currency, locale)
                  ) : (
                    // A broken formula says so where its number would be.
                    // Printing ₩NaN, or nothing at all, would leave the
                    // reader to work out that anything is wrong.
                    <span className="text-negative text-sm font-normal">
                      {outcome.error.kind === "notFinite"
                        ? t("formula.expressionBroken")
                        : t("formula.expressionInvalid")}
                    </span>
                  )}
                </span>
                {outcome.missing > 0 && (
                  <span className="text-warning w-full text-xs">
                    {t("formula.missingTerms").replace("{n}", String(outcome.missing))}
                  </span>
                )}
              </div>
            );
          })
        )}
      </Card>
      <Hint>{rows.length === 0 ? t("formula.emptyHint") : t("formula.snapshotHint")}</Hint>
    </section>
  );
}
