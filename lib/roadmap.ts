/**
 * 자산 로드맵 — the year-by-year arithmetic, with nothing else in it.
 *
 * One year compounds into the next:
 *
 *     기말 = (시작 + 저축) × (1 + 수익률)
 *
 * and next year's 시작 is this year's 기말. That is the whole model; the
 * interest is in what happens when the book already knows what a year
 * actually came to.
 *
 * So two tracks are rolled side by side rather than one:
 *
 * - **계획** never looks at the ledger. It runs from the starting figure
 *   to the last year on pure arithmetic, and is what the plan *said*
 *   before any of it happened.
 * - **실적** is the same arithmetic, except a year the book has an actual
 *   for takes that as its 기말 — and therefore hands it to the next year
 *   as its 시작. It is where the plan stands now that some of it is
 *   history.
 *
 * Both are shown. Overwriting the plan with the actuals would answer
 * "where am I heading from here" while destroying "what did I say I
 * would do", and comparing those two is the reason for the screen.
 */

/** A year that differs from the roadmap's defaults. Nulls fall back. */
export interface RoadmapOverride {
  year: string;
  contribution: number | null;
  returnRate: number | null;
  note: string | null;
}

/** Where a year's 저축액 came from, most specific first. */
export type ContributionSource = "override" | "derived" | "default";

export interface RoadmapRow {
  year: string;
  /** After the override, so this is what 전망 was actually computed with. */
  contribution: number;
  /**
   * What 계획 put in — the reader's own figure, never the derived one.
   * Differs from `contribution` exactly on the years the book could
   * speak for and the reader had not overridden.
   */
  planContribution: number;
  /**
   * How much of `contribution` has actually gone in already.
   *
   * The same figure for a year that is over. For the year in progress it
   * is only the months that have been lived, because the actual closing
   * figure beside it is today's — dividing today's balance by a whole
   * year's saving would credit the year with money that has not been put
   * in yet, and report a return far below the real one.
   */
  settledContribution: number;
  /** Whether the reader typed it, the book worked it out, or it fell back. */
  contributionSource: ContributionSource;
  returnRate: number;
  /** Whether a stored row spoke for this year — the edit affordance keys off it. */
  overridden: boolean;
  planStart: number;
  planEnd: number;
  liveStart: number;
  liveEnd: number;
  /** The book's own figure for this year end, or null if it has none. */
  actual: number | null;
  /**
   * What rate the year would have had to earn to land on `actual`, given
   * what went in. Null whenever there is no actual, or when nothing was
   * standing there to earn a return — a rate on a zero base is a division
   * by zero dressed up as a number.
   */
  actualReturnRate: number | null;
  note: string | null;
}

/**
 * Long enough for a whole working life and then some, short enough that
 * a fat-fingered end year cannot ask for a hundred thousand rows.
 */
export const MAX_ROADMAP_YEARS = 60;

/**
 * The years a roadmap covers, capped.
 *
 * Exported because the page needs the list *before* it can build the
 * roadmap — the ledger figures are fetched per year, and they are an
 * input to `buildRoadmap`, not an output of it. Keeping the cap here
 * means the query cannot ask for more years than the table will draw.
 */
export function roadmapYearList(startYear: string, endYear: string): string[] {
  const first = Number(startYear);
  const last = Number(endYear);
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) return [];

  const count = Math.min(last - first + 1, MAX_ROADMAP_YEARS);
  return Array.from({ length: count }, (_, i) => String(first + i));
}

export function buildRoadmap(params: {
  startYear: string;
  endYear: string;
  /** Minor units. */
  startingAmount: number;
  defaultContribution: number;
  /** A multiplier: 0.1 is 10%. */
  defaultReturnRate: number;
  overrides: readonly RoadmapOverride[];
  /** Year -> the book's figure for that year end, in minor units. */
  actualByYear?: ReadonlyMap<string, number>;
  /**
   * Year -> what the ledger and the budgets say went in that year.
   *
   * Beats the roadmap's flat default, because a figure the book worked
   * out from months that actually happened is better than one typed
   * once and never revisited. Beaten by a year's own override, because
   * the reader saying "this year is different" has to be the last word.
   *
   * A year nothing could be worked out for is simply absent — see
   * sumSavings in lib/savings, which returns null rather than zero for
   * exactly this reason.
   */
  contributionByYear?: ReadonlyMap<string, number>;
  /**
   * Year -> how much of that year's saving has actually happened.
   *
   * Only differs from `contributionByYear` for the year in progress, and
   * only matters for working the real return rate back out. Absent means
   * "all of it", which is true of every year that is over.
   */
  settledContributionByYear?: ReadonlyMap<string, number>;
}): RoadmapRow[] {
  const years = roadmapYearList(params.startYear, params.endYear);
  const overrideByYear = new Map(params.overrides.map((o) => [o.year, o]));

  const rows: RoadmapRow[] = [];
  let planStart = params.startingAmount;
  let liveStart = params.startingAmount;

  for (const year of years) {
    const override = overrideByYear.get(year);
    const derived = params.contributionByYear?.get(year);
    const contribution = override?.contribution ?? derived ?? params.defaultContribution;
    const contributionSource: ContributionSource =
      override?.contribution != null ? "override" : derived !== undefined ? "derived" : "default";
    /**
     * What the *plan* puts in, which is only ever what someone typed.
     *
     * The derived figure is deliberately not allowed in here. 계획 is the
     * answer to "what did I say I would do", and a line that moves every
     * time a transaction is entered or a budget edited cannot answer it —
     * it also kinked for a reason nobody chose, since only the years the
     * book can speak for got the derived figure and the rest fell back to
     * the default. 전망 is where the book's own arithmetic belongs.
     */
    const planContribution = override?.contribution ?? params.defaultContribution;
    const returnRate = override?.returnRate ?? params.defaultReturnRate;

    // Rounded once per year, not once at the end. This figure is both
    // what the row prints and what the next row starts from, so leaving
    // the fraction on would make the column fail to add up against
    // itself — the reader would be checking rounded numbers against an
    // unrounded chain.
    const planEnd = Math.round((planStart + planContribution) * (1 + returnRate));

    const actual = params.actualByYear?.get(year) ?? null;
    const base = liveStart + contribution;
    const liveEnd = actual ?? Math.round(base * (1 + returnRate));

    // The rate the year *did* earn, read back out of the identity the
    // whole table is built on:
    //
    //     (이전 기말 + 저축) × (1 + 수익률) = 기말
    //
    // against what has actually been put in rather than what is planned
    // to be — see settledContribution.
    const settledContribution = params.settledContributionByYear?.get(year) ?? contribution;
    const settledBase = liveStart + settledContribution;

    rows.push({
      year,
      contribution,
      planContribution,
      settledContribution,
      contributionSource,
      returnRate,
      overridden: override !== undefined,
      planStart,
      planEnd,
      liveStart,
      liveEnd,
      actual,
      actualReturnRate: actual === null || settledBase === 0 ? null : actual / settledBase - 1,
      note: override?.note ?? null,
    });

    planStart = planEnd;
    liveStart = liveEnd;
  }

  return rows;
}
