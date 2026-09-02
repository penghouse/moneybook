import type { AccountGroup } from "@/db/schema";

/** Which side of 「지금」 a month falls on, and so what spoke for it. */
export type YearCellSource = "actual" | "budget";

export interface YearCell {
  /** 'YYYY-MM'. */
  month: string;
  /**
   * Base-currency minor units: the ledger's figure for a month already
   * lived, the budget's for the one running and the ones ahead.
   */
  amount: number;
  /** What the month was budgeted at, or null where nothing was set. */
  plan: number | null;
  source: YearCellSource;
  /**
   * Nothing spoke for this cell — it is before the book begins, or it is
   * ahead of us with no budget. Told apart from a genuine zero, because
   * a zero is a claim and this is a gap.
   */
  blank: boolean;
}

/** Twelve cells and what they add up to. Every row, band and total is one. */
export interface YearLine {
  cells: YearCell[];
  /** The twelve cells added up — 실적 behind, 예산 ahead. */
  total: number;
  /** What the twelve months were planned at, however they turned out. */
  plan: number;
}

export interface YearRow extends YearLine {
  accountId: string;
  name: string;
}

export interface YearBand extends YearLine {
  /** 상위 그룹, or null for 미분류. */
  category: string | null;
  rows: YearRow[];
}

export interface YearSection extends YearLine {
  group: AccountGroup;
  bands: YearBand[];
}

export interface YearOverview {
  months: string[];
  sections: YearSection[];
  /** 수입 − 지출, month by month. */
  saving: YearLine;
  /** 저축가능액 running from January. Blended, like everything else. */
  cumulativeSaving: number[];
}

export interface YearAccount {
  id: string;
  name: string;
  group: AccountGroup;
  category: string | null;
}

/**
 * How much of the month's plan the month actually came to.
 *
 * Null for a month still running on its budget: there the figure *is*
 * the plan, and a column of 100%s would be the screen agreeing with
 * itself rather than saying anything about the year.
 */
export function monthAchievement(cell: YearCell): number | null {
  if (cell.source !== "actual" || cell.plan === null || cell.plan === 0) return null;
  return cell.amount / cell.plan;
}

/**
 * How far through the year's plan each month leaves us, counting from
 * January.
 *
 * This is the one that stays useful all year. It reads 실적 behind and
 * 예산 ahead, so December's figure is what the year is on course to come
 * to — and the months in between say whether it got there early.
 */
export function yearAchievements(line: YearLine): (number | null)[] {
  let running = 0;
  return line.cells.map((cell) => {
    running += cell.amount;
    return line.plan === 0 ? null : running / line.plan;
  });
}

function rollUp(months: readonly string[], lines: readonly YearLine[]): YearLine {
  const cells = months.map((month, i) => {
    const parts = lines.map((line) => line.cells[i]);
    const plans = parts.filter((cell) => cell.plan !== null);
    return {
      month,
      amount: parts.reduce((sum, cell) => sum + cell.amount, 0),
      plan: plans.length === 0 ? null : plans.reduce((sum, cell) => sum + (cell.plan ?? 0), 0),
      // Every part of a total agrees about which side of 지금 it is on,
      // so the first one can speak for all of them.
      source: parts[0]?.source ?? "budget",
      blank: parts.every((cell) => cell.blank),
    } satisfies YearCell;
  });

  return {
    cells,
    total: cells.reduce((sum, cell) => sum + cell.amount, 0),
    plan: cells.reduce((sum, cell) => sum + (cell.plan ?? 0), 0),
  };
}

/**
 * A year as twelve columns: what each account did, and what it was
 * supposed to do.
 *
 * The blending rule is the one `combineSavings` already uses for the
 * roadmap, and deliberately the same rule: a month behind us is read
 * from the ledger, and the month we are in is read from its budget
 * rather than from its half-finished total, which would show as a
 * suspiciously good month rather than an unfinished one.
 *
 * Both figures are kept for every month, not just the one on show. 달성률
 * is the point of the screen, and it needs the plan for months that have
 * already happened — which is exactly where the plan is otherwise
 * thrown away.
 */
export function buildYearOverview(params: {
  accounts: readonly YearAccount[];
  /** 'YYYY-MM', oldest first — twelve of them for a calendar year. */
  months: readonly string[];
  /** The month the book is in. Anything before it is history. */
  currentMonth: string;
  /** The first month the ledger knows anything about; null for an empty book. */
  firstLedgerMonth: string | null;
  /** month -> accountId -> base-currency minor units. */
  actualByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>;
  budgetByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** In the order the book lists them; anything but 수입·지출 is ignored. */
  groupOrder: readonly AccountGroup[];
}): YearOverview {
  const months = [...params.months];

  const lineFor = (account: YearAccount): YearRow => {
    const cells = months.map((month) => {
      const past = month < params.currentMonth;
      const plan = params.budgetByMonth.get(month)?.get(account.id) ?? null;
      const outsideBook = params.firstLedgerMonth === null || month < params.firstLedgerMonth;

      if (past) {
        const actual = params.actualByMonth.get(month)?.get(account.id);
        return {
          month,
          amount: outsideBook ? 0 : (actual ?? 0),
          plan,
          source: "actual",
          blank: outsideBook,
        } satisfies YearCell;
      }
      return {
        month,
        amount: plan ?? 0,
        plan,
        source: "budget",
        blank: plan === null,
      } satisfies YearCell;
    });

    return {
      accountId: account.id,
      name: account.name,
      cells,
      total: cells.reduce((sum, cell) => sum + cell.amount, 0),
      plan: cells.reduce((sum, cell) => sum + (cell.plan ?? 0), 0),
    };
  };

  const sections: YearSection[] = [];
  for (const group of params.groupOrder) {
    if (group !== "income" && group !== "expense") continue;

    const rows = params.accounts
      .filter((account) => account.group === group)
      .map(lineFor)
      // An account the whole year is silent about — no figure and no
      // plan in any of the twelve. A book has more accounts than any one
      // year uses, and a row of blanks is twelve columns of nothing.
      .filter((row) => !row.cells.every((cell) => cell.amount === 0 && cell.plan === null));
    if (rows.length === 0) continue;

    const byAccountId = new Map(params.accounts.map((a) => [a.id, a]));
    // 미분류 last: it is where things land before they are filed, not a
    // group of its own — the same order every other report uses.
    const categories = [
      ...new Set(rows.map((row) => byAccountId.get(row.accountId)?.category ?? null)),
    ].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));

    const bands: YearBand[] = categories.map((category) => {
      const inBand = rows.filter(
        (row) => (byAccountId.get(row.accountId)?.category ?? null) === category,
      );
      return { category, rows: inBand, ...rollUp(months, inBand) };
    });

    sections.push({ group, bands, ...rollUp(months, bands) });
  }

  const income = sections.find((s) => s.group === "income");
  const expense = sections.find((s) => s.group === "expense");
  const savingCells = months.map((month, i) => {
    const inflow = income?.cells[i];
    const outflow = expense?.cells[i];
    const plans = [inflow?.plan, outflow?.plan].filter((p) => p != null);
    return {
      month,
      amount: (inflow?.amount ?? 0) - (outflow?.amount ?? 0),
      plan: plans.length === 0 ? null : (inflow?.plan ?? 0) - (outflow?.plan ?? 0),
      source: inflow?.source ?? outflow?.source ?? "budget",
      blank: (inflow?.blank ?? true) && (outflow?.blank ?? true),
    } satisfies YearCell;
  });

  let running = 0;
  const cumulativeSaving = savingCells.map((cell) => (running += cell.amount));

  return {
    months,
    sections,
    saving: {
      cells: savingCells,
      total: savingCells.reduce((sum, cell) => sum + cell.amount, 0),
      plan: savingCells.reduce((sum, cell) => sum + (cell.plan ?? 0), 0),
    },
    cumulativeSaving,
  };
}
