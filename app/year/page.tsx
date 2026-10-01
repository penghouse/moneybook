import { Fragment } from "react";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, budgets } from "@/db/schema";
import { GROUP_LABEL_KEY } from "@/i18n/groups";
import { parseGroupOrder } from "@/lib/account-groups";
import { activeDuring } from "@/lib/accounts";
import { currentSection } from "@/lib/current-request";
import { addYears, today, yearMonthOf, yearOf, yearRange } from "@/lib/date";
import { getFirstLedgerMonth, getMonthlyAccountAmounts } from "@/lib/ledger";
import { formatCompactMoney, formatMoney } from "@/lib/money";
import {
  buildYearOverview,
  monthAchievement,
  monthVariance,
  yearAchievements,
  yearVariances,
  type YearCell,
  type YearLine,
} from "@/lib/year-overview";
import { PeriodNav } from "../_components/period-nav";
import {
  YearImage,
  type YearImageCell,
  type YearImageRow,
  type YearImageSection,
} from "./year-image";
import { Card, EmptyState, Hint, PageHeader, SectionLabel } from "../_components/ui";

const CELL = "px-2.5 py-1.5 whitespace-nowrap";
const NUM = `${CELL} tnum text-right`;
/**
 * Sticky, and opaque — the twelve columns slide *under* the names.
 *
 * Two constants rather than one plus an override: `bg-card bg-sunken` on
 * one element is two declarations of one property, and which of them
 * wins is decided by Tailwind's emit order rather than by anything
 * written here. The banded rows need the sunken ground, so they get
 * their own class built from the same base.
 */
const NAME_BASE = `${CELL} sticky left-0 z-10 text-left`;
const NAME = `${NAME_BASE} bg-card`;
const NAME_SUNKEN = `${NAME_BASE} bg-sunken`;

export default async function YearPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const params = await searchParams;

  const now = today(section.timezone);
  const year = /^\d{4}$/.test(params.year ?? "") ? params.year! : yearOf(now);
  const { from, to } = yearRange(year);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  const [catalog, budgetRows, actualByMonth, firstLedgerMonth] = await Promise.all([
    db.query.accounts.findMany({
      where: and(
        eq(accounts.sectionId, section.id),
        inArray(accounts.group, ["income", "expense"]),
        // The accounts that existed *that* year, one closed since
        // included — paging back to 2024 should show 2024's book.
        activeDuring(from, to),
      ),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    }),
    // One indexed range for the whole year rather than twelve queries;
    // the periodKey sorts the way it reads.
    db.query.budgets.findMany({
      where: and(
        eq(budgets.sectionId, section.id),
        eq(budgets.period, "month"),
        like(budgets.periodKey, `${year}-%`),
      ),
      columns: { periodKey: true, accountId: true, amount: true },
    }),
    getMonthlyAccountAmounts(db, { sectionId: section.id, months, mode: "flow" }),
    getFirstLedgerMonth(db, section.id),
  ]);

  const budgetByMonth = new Map<string, Map<string, number>>();
  for (const row of budgetRows) {
    const bucket = budgetByMonth.get(row.periodKey) ?? new Map<string, number>();
    bucket.set(row.accountId, row.amount);
    budgetByMonth.set(row.periodKey, bucket);
  }

  const overview = buildYearOverview({
    accounts: catalog,
    months,
    currentMonth: yearMonthOf(now),
    firstLedgerMonth,
    actualByMonth,
    budgetByMonth,
    groupOrder: parseGroupOrder(section.groupOrder),
  });

  const money = (minor: number) => formatMoney(minor, section.baseCurrency, locale);
  const compact = (minor: number) => formatCompactMoney(minor, section.baseCurrency, locale);
  const rateLabels = { month: t("year.monthRate"), year: t("year.yearRate") };
  const varianceLabels = { month: t("year.monthVariance"), year: t("year.yearVariance") };

  // An element rather than a component: the two tables want the same
  // thirteen headings, and React is happy to render one element twice.
  const monthHeads = (
    <>
      {months.map((month) => (
        <th key={month} scope="col" className={`${NUM} font-medium`}>
          {t("year.monthNumber").replace("{n}", String(Number(month.slice(5))))}
        </th>
      ))}
      <th scope="col" className={`${NUM} font-medium`}>
        {t("year.total")}
      </th>
    </>
  );

  /**
   * The same figures again, as strings for the canvas.
   *
   * Built here rather than in the picture: the screen has already
   * decided what every number is and which way it is inked, and a second
   * opinion in the drawing code is a second thing to keep in step.
   */
  const cell = (text: string, tone: YearImageCell["tone"] = "ink"): YearImageCell => ({
    text,
    tone,
  });
  const amountCells = (line: YearLine) =>
    line.cells.map((c) =>
      c.blank || c.amount === 0
        ? null
        : cell(compact(c.amount), c.source === "budget" ? "faint" : "ink"),
    );
  const rateCells = (line: YearLine, overIsGood: boolean) => {
    const yearly = yearAchievements(line);
    const tone = (rate: number | null, pace: number) =>
      rate === null
        ? null
        : cell(percent(rate), (overIsGood ? rate >= pace : rate <= pace) ? "good" : "bad");
    return {
      month: line.cells.map((c) => tone(monthAchievement(c), 1)),
      year: line.cells.map((c, i) => tone(yearly[i].rate, yearly[i].pace ?? 1)),
    };
  };

  const imageSections: YearImageSection[] = overview.sections.map((group) => {
    const rows: YearImageRow[] = [];
    for (const band of group.bands) {
      if (group.bands.length > 1) {
        rows.push({
          label: band.category ?? t("accounts.uncategorized"),
          level: "band",
          cells: amountCells(band),
          total: cell(compact(band.total), "muted"),
        });
      }
      for (const row of band.rows) {
        rows.push({
          label: row.name,
          level: "account",
          cells: amountCells(row),
          total: cell(compact(row.total)),
        });
      }
    }
    const rates = rateCells(group, group.group === "income");
    rows.push({
      label: t("year.sum"),
      level: "total",
      cells: amountCells(group),
      total: cell(compact(group.total)),
    });
    rows.push({ label: t("year.monthRate"), level: "note", cells: rates.month, total: null });
    rows.push({
      label: t("year.yearRate"),
      level: "note",
      cells: rates.year,
      total: cell(compact(group.plan), "muted"),
    });
    return { key: group.group, label: t(GROUP_LABEL_KEY[group.group]), rows };
  });

  if (overview.sections.length > 0) {
    const variance = (value: number | null): YearImageCell | null =>
      value === null
        ? null
        : cell(
            `${value > 0 ? "+" : ""}${compact(value)}`,
            value === 0 ? "muted" : value > 0 ? "good" : "bad",
          );
    const running = yearVariances(overview.saving);
    imageSections.push({
      key: "saving",
      label: t("year.saving"),
      rows: [
        {
          label: t("year.saving"),
          level: "total",
          cells: amountCells(overview.saving),
          total: cell(compact(overview.saving.total)),
        },
        {
          label: t("year.cumulative"),
          level: "note",
          cells: overview.cumulativeSaving.map((amount) => cell(compact(amount), "muted")),
          total: null,
        },
        {
          label: t("year.monthVariance"),
          level: "note",
          cells: overview.saving.cells.map((c) => variance(monthVariance(c))),
          total: null,
        },
        {
          label: t("year.yearVariance"),
          level: "note",
          cells: running.map(variance),
          total: cell(compact(overview.saving.plan), "muted"),
        },
      ],
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.year")}>
        {imageSections.length > 0 && (
          <YearImage
            year={year}
            sections={imageSections}
            labels={{
              save: t("budget.saveImage"),
              saving: t("common.saving"),
              confirm: t("budget.makeImage"),
              close: t("common.close"),
              title: t("nav.year"),
              line: t("year.line"),
              total: t("year.total"),
              monthNumber: t("year.monthNumber"),
              note: t("year.imageNote"),
            }}
          />
        )}
      </PageHeader>

      <PeriodNav
        prevHref={`/year?year=${addYears(year, -1)}`}
        nextHref={`/year?year=${addYears(year, 1)}`}
        label={year}
        prevLabel={t("common.prevYear")}
        nextLabel={t("common.nextYear")}
        shortPrev={t("common.prev")}
        shortNext={t("common.next")}
      />

      {overview.sections.length === 0 ? (
        <Card>
          <EmptyState>{t("year.empty")}</EmptyState>
        </Card>
      ) : (
        <>
          {overview.sections.map((group) => (
            <section key={group.group}>
              <SectionLabel>{t(GROUP_LABEL_KEY[group.group])}</SectionLabel>
              <Card>
                {/* The scroller is inside the card, not the card itself:
                    a Card always carries overflow-hidden — that is what
                    clips its rounded corners — so an overflow utility
                    beside it is two declarations of one property, and
                    which wins is decided by Tailwind's emit order. */}
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-rule-soft text-ink-faint border-b">
                        <th scope="col" className={`${NAME} font-medium`}>
                          {t("year.account")}
                        </th>
                        {monthHeads}
                      </tr>
                    </thead>
                    <tbody>
                      {group.bands.map((band) => (
                        <Fragment key={band.category ?? " uncategorized"}>
                          {group.bands.length > 1 && (
                            <tr className="bg-sunken border-rule-soft border-t">
                              <th
                                scope="row"
                                className={`${NAME_SUNKEN} text-ink-muted text-xs font-semibold`}
                              >
                                {band.category ?? t("accounts.uncategorized")}
                              </th>
                              {band.cells.map((cell) => (
                                <Cell
                                  key={cell.month}
                                  cell={cell}
                                  compact={compact}
                                  className="text-xs"
                                />
                              ))}
                              <td className={`${NUM} text-ink-muted text-xs font-semibold`}>
                                {compact(band.total)}
                              </td>
                            </tr>
                          )}
                          {band.rows.map((row) => (
                            <tr
                              key={row.accountId}
                              data-testid="year-row"
                              className="border-rule-soft border-t"
                            >
                              <th scope="row" className={`${NAME} font-normal`}>
                                {row.name}
                              </th>
                              {row.cells.map((cell) => (
                                <Cell key={cell.month} cell={cell} compact={compact} />
                              ))}
                              <td className={`${NUM} font-semibold`}>{compact(row.total)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}

                      <tr
                        data-testid="year-total"
                        className="border-rule bg-sunken border-t-2 font-bold"
                      >
                        <th scope="row" className={NAME_SUNKEN}>
                          {t("year.sum")}
                        </th>
                        {group.cells.map((cell) => (
                          <Cell key={cell.month} cell={cell} compact={compact} />
                        ))}
                        <td className={NUM}>{compact(group.total)}</td>
                      </tr>
                      <RateRows
                        line={group}
                        overIsGood={group.group === "income"}
                        labels={rateLabels}
                        compact={compact}
                      />
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          ))}

          <section>
            <SectionLabel>{t("year.saving")}</SectionLabel>
            <Card>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-rule-soft text-ink-faint border-b">
                      <th scope="col" className={`${NAME} font-medium`}>
                        {t("year.line")}
                      </th>
                      {monthHeads}
                    </tr>
                  </thead>
                  <tbody>
                    <tr data-testid="year-saving" className="font-semibold">
                      <th scope="row" className={NAME}>
                        {t("year.saving")}
                      </th>
                      {overview.saving.cells.map((cell) => (
                        <Cell key={cell.month} cell={cell} compact={compact} />
                      ))}
                      <td className={NUM}>{compact(overview.saving.total)}</td>
                    </tr>
                    <tr data-testid="year-cumulative" className="border-rule-soft border-t">
                      <th scope="row" className={`${NAME} text-ink-muted text-xs font-medium`}>
                        {t("year.cumulative")}
                      </th>
                      {overview.cumulativeSaving.map((amount, i) => (
                        <td key={months[i]} className={`${NUM} text-ink-muted text-xs`}>
                          {compact(amount)}
                        </td>
                      ))}
                      <td className={NUM} />
                    </tr>
                    {/* Money, not a percentage. See monthVariance: a
                        residual's ratio inverts on a negative plan, has
                        nothing to divide by on a break-even one, and
                        stops being about saving at all when only one
                        side was budgeted. */}
                    <VarianceRows
                      line={overview.saving}
                      labels={varianceLabels}
                      compact={compact}
                    />
                  </tbody>
                </table>
              </div>
            </Card>
            <Hint>{t("year.hint").replace("{total}", money(overview.saving.total))}</Hint>
          </section>
        </>
      )}
    </div>
  );
}

const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * One month's figure.
 *
 * Compact — 「1443만」 rather than 「₩14,430,000」. Thirteen columns of full
 * won is a table nobody can hold in their head and a scrollbar three
 * screens wide; this is an overview, and the exact figure is one tap
 * away on 예산 or 기간손익.
 *
 * Faint where the month is still running on its budget, so the eye can
 * see at a glance where the ledger stops and the plan takes over.
 */
function Cell({
  cell,
  compact,
  className = "",
}: {
  cell: YearCell;
  compact: (minor: number) => string;
  className?: string;
}) {
  return (
    <td
      className={`${NUM} ${className} ${cell.source === "budget" ? "text-ink-faint" : ""}`}
      data-testid="year-cell"
      data-source={cell.source}
      data-month={cell.month}
    >
      {cell.blank || cell.amount === 0 ? "" : compact(cell.amount)}
    </td>
  );
}

/**
 * 달성률 — over or under, in the book's two colours, but which way round
 * depends on the side. Spending 120% of the plan is bad news; earning
 * 120% of it is not.
 *
 * `pace` is what being on track *means* at this point in the row. For a
 * month it is the whole month's plan, so 1. For the running year it is
 * how much of the year has gone: by the end of January a fifth of the
 * year's budget is not thrift and a twelfth of the year's income is not
 * a shortfall — both are simply January, and colouring them against 100%
 * painted every early month with a verdict nobody had earned yet.
 */
function Rate({
  rate,
  overIsGood,
  pace = 1,
}: {
  rate: number | null;
  overIsGood: boolean;
  pace?: number;
}) {
  if (rate === null) return <td className={NUM} />;
  const good = overIsGood ? rate >= pace : rate <= pace;
  return (
    <td
      className={`${NUM} font-semibold ${good ? "text-positive" : "text-negative"}`}
      data-testid="year-rate"
    >
      {percent(rate)}
    </td>
  );
}

/** The two 달성률 lines that sit under a total. */
function RateRows({
  line,
  overIsGood,
  labels,
  compact,
}: {
  line: YearLine;
  overIsGood: boolean;
  labels: { month: string; year: string };
  compact: (minor: number) => string;
}) {
  const yearly = yearAchievements(line);
  return (
    <>
      <tr className="border-rule-soft border-t" data-testid="year-month-rate">
        <th scope="row" className={`${NAME} text-ink-muted text-xs font-medium`}>
          {labels.month}
        </th>
        {line.cells.map((cell) => (
          <Rate key={cell.month} rate={monthAchievement(cell)} overIsGood={overIsGood} />
        ))}
        <td className={NUM} />
      </tr>
      <tr data-testid="year-year-rate">
        <th scope="row" className={`${NAME} text-ink-muted text-xs font-medium`}>
          {labels.year}
        </th>
        {line.cells.map((cell, i) => (
          <Rate
            key={cell.month}
            rate={yearly[i].rate}
            overIsGood={overIsGood}
            pace={yearly[i].pace ?? 1}
          />
        ))}
        {/* The plan the whole row is measured against, at the end of the
            row that measures against it. */}
        <td className={`${NUM} text-ink-muted text-xs`}>{compact(line.plan)}</td>
      </tr>
    </>
  );
}

/**
 * One figure in a 차이 row: how far off the plan, in money.
 *
 * Signed on purpose — a bare 「12만」 does not say which way. Exactly on
 * plan is neither good nor bad news, so it is left in the muted ink the
 * labels use rather than painted green.
 */
function Variance({ value, compact }: { value: number | null; compact: (m: number) => string }) {
  if (value === null) return <td className={NUM} />;
  if (value === 0) {
    return (
      <td className={`${NUM} text-ink-muted`} data-testid="year-variance">
        {compact(0)}
      </td>
    );
  }
  return (
    <td
      className={`${NUM} font-semibold ${value > 0 ? "text-positive" : "text-negative"}`}
      data-testid="year-variance"
    >
      {value > 0 ? "+" : ""}
      {compact(value)}
    </td>
  );
}

/** The 저축 card's two lines, which read in won rather than in percent. */
function VarianceRows({
  line,
  labels,
  compact,
}: {
  line: YearLine;
  labels: { month: string; year: string };
  compact: (minor: number) => string;
}) {
  const yearly = yearVariances(line);
  return (
    <>
      <tr className="border-rule-soft border-t" data-testid="year-month-rate">
        <th scope="row" className={`${NAME} text-ink-muted text-xs font-medium`}>
          {labels.month}
        </th>
        {line.cells.map((cell) => (
          <Variance key={cell.month} value={monthVariance(cell)} compact={compact} />
        ))}
        <td className={NUM} />
      </tr>
      <tr data-testid="year-year-rate">
        <th scope="row" className={`${NAME} text-ink-muted text-xs font-medium`}>
          {labels.year}
        </th>
        {line.cells.map((cell, i) => (
          <Variance key={cell.month} value={yearly[i]} compact={compact} />
        ))}
        <td className={`${NUM} text-ink-muted text-xs`}>{compact(line.plan)}</td>
      </tr>
    </>
  );
}
