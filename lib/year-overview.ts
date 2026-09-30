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
  /**
   * The part of `amount` that had a plan to be measured against.
   *
   * The same as `amount` on a row that was budgeted, zero on one that
   * was not, and on a total the sum of the parts that were. 달성률 needs
   * this rather than `amount`: counting spending that had no budget
   * against a denominator that could not include it reported a section
   * at 133% with nothing in it over its plan — the unbudgeted account
   * was in the numerator alone.
   */
  planned: number;
  source: YearCellSource;
  /**
   * Whether the month is behind us and will not move again.
   *
   * Told apart from `source`, which says where the figure came from. The
   * month in progress can be read from the ledger — see
   * `buildYearOverview` on overspending — and would then look settled to
   * anything that judged by provenance alone.
   */
  settled: boolean;
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
  if (!cell.settled || cell.plan === null || cell.plan === 0) return null;
  return cell.planned / cell.plan;
}

export interface YearProgress {
  /** How much of the year's plan has gone by the end of this month. */
  rate: number | null;
  /**
   * Where being exactly on plan would put it by now — the share of the
   * year's plan these months carry.
   *
   * Not simply the months elapsed: a year budgeted 50만 a month except
   * 200만 in December is a quarter spent by the end of January only if
   * every month is the same size, and the months are not.
   */
  pace: number | null;
}

/**
 * How far through the year's plan each month leaves us, counting from
 * January.
 *
 * This is the one that stays useful all year. It reads 실적 behind and
 * 예산 ahead, so December's figure is what the year is on course to come
 * to — and the months in between say whether it got there early.
 *
 * Both sides are the planned part only. A year holds accounts and months
 * nobody budgeted, and their spending is real but has nothing to be
 * measured against; letting it into the numerator alone made the rate a
 * statement about how much of the book has a budget rather than about
 * the plan. It is still in the cells and in the 합계 column, where it is
 * not pretending to be a comparison.
 */
export function yearAchievements(line: YearLine): YearProgress[] {
  let running = 0;
  let runningPlan = 0;
  return line.cells.map((cell) => {
    running += cell.planned;
    runningPlan += cell.plan ?? 0;
    return line.plan === 0
      ? { rate: null, pace: null }
      : { rate: running / line.plan, pace: runningPlan / line.plan };
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
      planned: parts.reduce((sum, cell) => sum + cell.planned, 0),
      // A month's parts can disagree about provenance — in the month in
      // progress one account may be over its plan and read from the
      // ledger while the rest still read from theirs — so a total is
      // only wholly the plan when every part of it is.
      source: parts.some((cell) => cell.source === "actual") ? "actual" : "budget",
      // Which side of 지금 the month falls on, though, they cannot
      // disagree about.
      settled: parts[0]?.settled ?? false,
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
          planned: plan === null || outsideBook ? 0 : (actual ?? 0),
          source: "actual",
          settled: true,
          blank: outsideBook,
        } satisfies YearCell;
      }

      // The month in progress reads from its budget — until the ledger
      // has already passed it. A plan the book can show is spent is not
      // a forecast any more, and printing 60만 where 74만 has gone
      // out understates the year by exactly the part worth knowing
      // about. Nothing ahead of us can be over, so this only ever moves
      // the month we are in.
      const spent =
        month === params.currentMonth ? (params.actualByMonth.get(month)?.get(account.id) ?? 0) : 0;
      const over = spent > (plan ?? 0);
      return {
        month,
        amount: over ? spent : (plan ?? 0),
        plan,
        planned: plan === null ? 0 : over ? spent : plan,
        source: over ? "actual" : "budget",
        settled: false,
        blank: !over && plan === null,
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
      planned: (inflow?.planned ?? 0) - (outflow?.planned ?? 0),
      source: inflow?.source === "actual" || outflow?.source === "actual" ? "actual" : "budget",
      settled: inflow?.settled ?? outflow?.settled ?? false,
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
