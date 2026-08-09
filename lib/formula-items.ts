import type { AccountGroup, FormulaScope } from "@/db/schema";
import { termKey, type FormulaTotal } from "./formulas";

/**
 * The menu a formula picks its terms from, and what each of them is
 * worth right now.
 *
 * One function for both, because the editor and the report must not
 * disagree about either. If the editor offered 「유동성자금」 and the
 * balance sheet worked out a different 유동성자금, the formula would be
 * wrong in a way nobody could see — so the list and the values are built
 * from the same pass over the same accounts.
 *
 * The menu is laid out the way the report is: each group in the book's
 * own order, its 상위 그룹 with their accounts under them, and the
 * derived total last. A reader picking terms is looking at the screen
 * they came from.
 */

export interface FormulaItem {
  /** `termKey` of the thing this row selects. */
  key: string;
  label: string;
  /** How far in to indent it, and how heavy to set it. */
  level: "total" | "category" | "account";
  /** Base-currency minor units as the report has it right now. */
  amount: number;
}

/** Which group totals belong to which scope, and how each is summed. */
const SCOPE_GROUPS: Record<FormulaScope, readonly [AccountGroup, AccountGroup]> = {
  assets: ["asset", "liability"],
  income: ["income", "expense"],
};

const GROUP_TOTAL: Record<string, FormulaTotal> = {
  asset: "assets",
  liability: "liabilities",
  income: "income",
  expense: "expense",
};

export interface FormulaSourceAccount {
  id: string;
  name: string;
  group: AccountGroup;
  category: string | null;
}

export function buildFormulaItems(params: {
  scope: FormulaScope;
  /** The book's group order, unfiltered — this picks its own two out of it. */
  groupOrder: readonly AccountGroup[];
  /** The catalog, already in the book's account order. */
  accounts: readonly FormulaSourceAccount[];
  /**
   * Base-currency minor units per account, normal-balance direction —
   * exactly the numbers the report prints. An account the report has no
   * figure for counts as zero, the same as it reads on screen.
   */
  amountByAccountId: ReadonlyMap<string, number>;
  labels: {
    /** Label per total key: assets/liabilities/netWorth or income/expense/netIncome. */
    totals: Readonly<Record<string, string>>;
  };
}): FormulaItem[] {
  const { scope, accounts, amountByAccountId, labels } = params;
  const scopeGroups = SCOPE_GROUPS[scope];
  const groups = params.groupOrder.filter((g) => scopeGroups.includes(g));
  // A book whose group order somehow lost one of them still gets both:
  // an item missing from this menu is a term nobody can pick.
  for (const g of scopeGroups) if (!groups.includes(g)) groups.push(g);

  const amountOf = (id: string) => amountByAccountId.get(id) ?? 0;
  const items: FormulaItem[] = [];
  const totals = new Map<AccountGroup, number>();

  for (const group of groups) {
    const inGroup = accounts.filter((a) => a.group === group);
    const groupTotal = inGroup.reduce((sum, a) => sum + amountOf(a.id), 0);
    totals.set(group, groupTotal);

    const totalKey = GROUP_TOTAL[group];
    items.push({
      key: termKey({ kind: "total", total: totalKey }),
      label: labels.totals[totalKey] ?? totalKey,
      level: "total",
      amount: groupTotal,
    });

    // Categories in the order their first account appears, so the menu
    // follows the order set on /accounts rather than the alphabet.
    const categories: string[] = [];
    for (const a of inGroup) {
      if (a.category && !categories.includes(a.category)) categories.push(a.category);
    }

    for (const category of categories) {
      const inCategory = inGroup.filter((a) => a.category === category);
      items.push({
        key: termKey({ kind: "category", group, name: category }),
        label: category,
        level: "category",
        amount: inCategory.reduce((sum, a) => sum + amountOf(a.id), 0),
      });
      for (const a of inCategory) {
        items.push({
          key: termKey({ kind: "account", accountId: a.id }),
          label: a.name,
          level: "account",
          amount: amountOf(a.id),
        });
      }
    }

    // Accounts with no 상위 그룹 sit under the group itself. No
    // 「미분류」 bucket to pick: it would be a term that silently changes
    // meaning every time an account is filed away.
    for (const a of inGroup.filter((x) => !x.category)) {
      items.push({
        key: termKey({ kind: "account", accountId: a.id }),
        label: a.name,
        level: "account",
        amount: amountOf(a.id),
      });
    }
  }

  const derived: FormulaTotal = scope === "assets" ? "netWorth" : "netIncome";
  const [positive, negative] = scopeGroups;
  items.push({
    key: termKey({ kind: "total", total: derived }),
    label: labels.totals[derived] ?? derived,
    level: "total",
    amount: (totals.get(positive) ?? 0) - (totals.get(negative) ?? 0),
  });

  return items;
}

/** The value map `evaluateFormula` reads, straight off the menu. */
export function formulaValues(items: readonly FormulaItem[]): Map<string, number> {
  return new Map(items.map((item) => [item.key, item.amount]));
}
