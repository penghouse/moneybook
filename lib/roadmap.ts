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

export interface RoadmapRow {
  year: string;
  /** After the override, so this is what the row was actually computed with. */
  contribution: number;
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
}): RoadmapRow[] {
  const years = roadmapYearList(params.startYear, params.endYear);
  const overrideByYear = new Map(params.overrides.map((o) => [o.year, o]));

  const rows: RoadmapRow[] = [];
  let planStart = params.startingAmount;
  let liveStart = params.startingAmount;

  for (const year of years) {
    const override = overrideByYear.get(year);
    const contribution = override?.contribution ?? params.defaultContribution;
    const returnRate = override?.returnRate ?? params.defaultReturnRate;

    // Rounded once per year, not once at the end. This figure is both
    // what the row prints and what the next row starts from, so leaving
    // the fraction on would make the column fail to add up against
    // itself — the reader would be checking rounded numbers against an
    // unrounded chain.
    const planEnd = Math.round((planStart + contribution) * (1 + returnRate));

    const actual = params.actualByYear?.get(year) ?? null;
    const base = liveStart + contribution;
    const liveEnd = actual ?? Math.round(base * (1 + returnRate));

    rows.push({
      year,
      contribution,
      returnRate,
      overridden: override !== undefined,
      planStart,
      planEnd,
      liveStart,
      liveEnd,
      actual,
      actualReturnRate: actual === null || base === 0 ? null : actual / base - 1,
      note: override?.note ?? null,
    });

    planStart = planEnd;
    liveStart = liveEnd;
  }

  return rows;
}
