import type { AccountGroup, FormulaScope } from "@/db/schema";
import type { Db } from "@/db/types";
import { buildFormulaItems, formulaValues, type FormulaSourceAccount } from "./formula-items";
import { evaluateFormula, parseTerms } from "./formulas";
import { getMonthlyAccountAmounts } from "./ledger";

export interface ReportSeries {
  key: string;
  name: string;
  /** One figure per month, in the order the months were asked for. */
  values: number[];
}

/**
 * Every 상위 그룹 and every 계산식 drawn over the same months.
 *
 * Built by running each month's figures through the very machinery the
 * report and the 계산식 editor use: the month's per-account amounts go
 * into `buildFormulaItems`, which yields that month's 상위 그룹 totals,
 * and the formulas are evaluated against the same map. A category on
 * this chart therefore cannot mean anything other than the category on
 * the report, and a formula cannot drift from the number at its foot.
 */
export async function buildReportSeries(
  db: Db,
  params: {
    sectionId: string;
    scope: FormulaScope;
    /** 'YYYY-MM', oldest first. */
    months: readonly string[];
    baseCurrency: string;
    groupOrder: readonly AccountGroup[];
    accounts: readonly FormulaSourceAccount[];
    formulas: readonly { id: string; name: string; terms: string; expression: string }[];
    totalLabels: Readonly<Record<string, string>>;
  },
): Promise<ReportSeries[]> {
  if (params.months.length === 0) return [];

  const amounts = await getMonthlyAccountAmounts(db, {
    sectionId: params.sectionId,
    months: params.months,
    // A balance carries forward and a flow does not — the same
    // distinction the two reports are built on.
    mode: params.scope === "assets" ? "balance" : "flow",
  });

  const byKey = new Map<string, ReportSeries>();
  const push = (key: string, name: string, index: number, value: number) => {
    let series = byKey.get(key);
    if (!series) {
      series = { key, name, values: new Array(params.months.length).fill(0) };
      byKey.set(key, series);
    }
    series.values[index] = value;
  };

  const parsed = params.formulas.map((f) => ({
    id: f.id,
    name: f.name,
    terms: parseTerms(f.terms),
    expression: f.expression,
  }));

  params.months.forEach((month, index) => {
    const items = buildFormulaItems({
      scope: params.scope,
      groupOrder: params.groupOrder,
      accounts: params.accounts,
      amountByAccountId: amounts.get(month) ?? new Map(),
      labels: { totals: params.totalLabels },
    });

    for (const item of items) {
      if (item.level === "category") push(item.key, item.label, index, item.amount);
    }

    const values = { byKey: formulaValues(items) };
    for (const formula of parsed) {
      const outcome = evaluateFormula(formula, values, params.baseCurrency);
      // A formula that cannot be worked out contributes nothing to its
      // line rather than a spike at zero-divided-by-something.
      push(`formula:${formula.id}`, formula.name, index, outcome.ok ? outcome.amount : 0);
    }
  });

  return [...byKey.values()];
}
