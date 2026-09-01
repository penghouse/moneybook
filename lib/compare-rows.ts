import type { AccountGroup } from "@/db/schema";

export interface ComparedAccount {
  accountId: string;
  name: string;
  group: AccountGroup;
  category: string | null;
  previous: number;
  current: number;
  /** current − previous. Positive means the figure grew. */
  change: number;
}

export interface ComparedGroup {
  group: AccountGroup;
  previous: number;
  current: number;
  change: number;
  bands: {
    category: string | null;
    previous: number;
    current: number;
    change: number;
    rows: ComparedAccount[];
  }[];
}

interface Amount {
  accountId: string;
  baseAmount: number;
}

interface CatalogAccount {
  id: string;
  name: string;
  group: AccountGroup;
  category: string | null;
}

/**
 * Two periods laid side by side, account by account.
 *
 * Driven by the catalog rather than by either period's rows: an account
 * that appeared this month and not last, or stopped this month after
 * years of it, is exactly what the comparison is for. Reading only the
 * accounts one side happens to mention would quietly drop half of them —
 * and 「사라진 지출」 is the interesting half.
 *
 * An account both periods are silent about is left out entirely. Two
 * zeroes and a zero difference is a row that says nothing, and a book
 * has more accounts than any one month uses.
 */
export function compareAccounts(params: {
  accounts: readonly CatalogAccount[];
  previous: readonly Amount[];
  current: readonly Amount[];
  /** In the order the book lists them — 자산·부채 or 수익·비용. */
  groupOrder: readonly AccountGroup[];
}): ComparedGroup[] {
  const previousById = new Map(params.previous.map((a) => [a.accountId, a.baseAmount]));
  const currentById = new Map(params.current.map((a) => [a.accountId, a.baseAmount]));

  const compared: ComparedAccount[] = [];
  for (const account of params.accounts) {
    const previous = previousById.get(account.id) ?? 0;
    const current = currentById.get(account.id) ?? 0;
    if (previous === 0 && current === 0) continue;
    compared.push({
      accountId: account.id,
      name: account.name,
      group: account.group,
      category: account.category,
      previous,
      current,
      change: current - previous,
    });
  }

  const total = (rows: readonly ComparedAccount[]) => ({
    previous: rows.reduce((sum, r) => sum + r.previous, 0),
    current: rows.reduce((sum, r) => sum + r.current, 0),
    change: rows.reduce((sum, r) => sum + r.change, 0),
  });

  return params.groupOrder
    .map((group) => {
      const inGroup = compared.filter((row) => row.group === group);
      // Uncategorised last: it is where things land before they are
      // filed, not a group of its own — the same order every report uses.
      const categories = [...new Set(inGroup.map((row) => row.category))].sort((a, b) =>
        a === null ? 1 : b === null ? -1 : 0,
      );

      return {
        group,
        ...total(inGroup),
        bands: categories.map((category) => {
          const rows = inGroup.filter((row) => row.category === category);
          return { category, ...total(rows), rows };
        }),
      };
    })
    .filter((group) => group.bands.length > 0);
}
