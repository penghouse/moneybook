import { cookies } from "next/headers";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, formulas } from "@/db/schema";
import { currentSection } from "@/lib/current-request";
import {
  addMonths,
  monthRange,
  monthsBetween,
  shiftWindow,
  today,
  yearMonthOf,
  yearsBetween,
} from "@/lib/date";
import { parseGroupOrder } from "@/lib/account-groups";
import { getPeriodTotals } from "@/lib/ledger";
import { DEFAULT_SERIES, parseSeries, seriesCookieName } from "@/lib/chart-series";
import { buildReportSeries } from "@/lib/report-series";
import { formatMoney } from "@/lib/money";
import { formulaTotalLabels } from "../../_components/formula-section";
import { NetIncomeChart } from "../../_components/net-income-chart";
import { SeriesChart } from "../../_components/series-chart";
import { PeriodNav } from "../../_components/period-nav";
import {
  buttonClass,
  Card,
  controlClass,
  EmptyState,
  Hint,
  Label,
  PageHeader,
  SectionLabel,
} from "../../_components/ui";

/** How far back the range reaches when nothing is asked for. */
const DEFAULT_MONTHS = 12;

export default async function IncomeChartPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; unit?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const { from: fromParam, to: toParam, unit: unitParam } = await searchParams;

  const to = toParam ?? today(section.timezone);
  const from = fromParam ?? `${addMonths(yearMonthOf(to), -(DEFAULT_MONTHS - 1))}-01`;
  // The bar's width, not the range's: the same five years reads as sixty
  // months or as five years, and which one answers your question is not
  // something the dates can say. Twelve fixed months and five fixed
  // years — the old, unmovable pair — could answer neither.
  const byYear = unitParam === "year";

  const start = from > to ? to : from;
  const periods = byYear ? yearsBetween(start, to) : monthsBetween(start, to);
  const [totals, catalog, formulaRows] = await Promise.all([
    getPeriodTotals(db, { sectionId: section.id, periods }),
    db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    }),
    db.query.formulas.findMany({
      where: and(eq(formulas.sectionId, section.id), eq(formulas.scope, "income")),
      orderBy: asc(formulas.sortOrder),
    }),
  ]);
  const points = totals.map((p) => ({
    label: p.period,
    // '2026-08' → '08', '2026' → '26'. Two characters is what the tick
    // has room for at twelve bars across a phone.
    tick: byYear ? p.period.slice(2) : p.period.slice(5),
    income: p.income,
    expense: p.expense,
    net: p.income - p.expense,
  }));

  const totalIncome = points.reduce((s, p) => s + p.income, 0);
  const totalExpense = points.reduce((s, p) => s + p.expense, 0);
  const netIncome = totalIncome - totalExpense;
  const hasHistory = points.some((p) => p.income !== 0 || p.expense !== 0);

  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);
  const unitHref = (next: "month" | "year") => `/income/chart?from=${from}&to=${to}&unit=${next}`;
  const trendLabel = byYear ? t("income.trendByYear") : t("income.trendByMonth");

  // Always by month, whatever the bars above are set to: a line per
  // year over a five-year window is four segments, which is a table
  // wearing a chart's clothes.
  const seriesMonths = monthsBetween(start, to);
  const reportSeries = await buildReportSeries(db, {
    sectionId: section.id,
    scope: "income",
    months: seriesMonths,
    baseCurrency: section.baseCurrency,
    groupOrder: parseGroupOrder(section.groupOrder),
    accounts: catalog,
    formulas: formulaRows,
    totalLabels: formulaTotalLabels("income", t),
  });

  // The window moves by its own length, so paging back from twelve
  // months lands on the twelve before — the comparison the chart is for.
  // A fixed month step would leave eleven of the twelve on screen and
  // make every press look like nothing happened.
  const stepHref = (delta: number) => {
    const next = shiftWindow(start, to, delta);
    return `/income/chart?from=${next.from}&to=${next.to}&unit=${byYear ? "year" : "month"}`;
  };

  // The legend's on/off choice, as it was left. Kept in a cookie and read
  // here rather than restored on the client, so the page renders with the
  // right series already on — 이전/다음 기간 is an ordinary navigation, and
  // a chart that reset itself on every step was the complaint.
  const seriesCookie = seriesCookieName("income");
  const stored = parseSeries(
    (await cookies()).get(seriesCookie)?.value,
    reportSeries.map((s) => s.key),
  );
  const initialSeries = stored ?? reportSeries.slice(0, DEFAULT_SERIES).map((s) => s.key);

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.incomeChart")}>
        <form className="flex flex-wrap items-end gap-2" action="/income/chart">
          <div>
            <Label>{t("assets.rangeFrom")}</Label>
            <input type="date" name="from" defaultValue={from} className={`${controlClass} tnum`} />
          </div>
          <div>
            <Label>{t("assets.rangeTo")}</Label>
            <input type="date" name="to" defaultValue={to} className={`${controlClass} tnum`} />
          </div>
          {/* Carried through the form, or 조회 would silently drop the
              reader back to months. */}
          <input type="hidden" name="unit" value={byYear ? "year" : "month"} />
          <button type="submit" className={buttonClass("secondary")}>
            {t("common.apply")}
          </button>
        </form>
      </PageHeader>

      <Card>
        <div className="px-4 py-4">
          <div className="text-ink-faint text-xs tracking-wide">{t("income.netIncome")}</div>
          <div
            className={`tnum mt-1 mb-3.5 text-[2rem] leading-tight font-bold tracking-tighter ${
              netIncome > 0 ? "text-positive" : netIncome < 0 ? "text-negative" : ""
            }`}
          >
            {base(netIncome)}
          </div>
          <div className="text-ink-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              {t("income.totalIncome")}{" "}
              <b className="tnum text-ink font-semibold">{base(totalIncome)}</b>
            </span>
            <span>
              {t("income.totalExpense")}{" "}
              <b className="tnum text-ink font-semibold">{base(totalExpense)}</b>
            </span>
          </div>
        </div>
      </Card>

      {/* The arrows move the whole window; the switch below them sets
          how wide a bar is, not how long the range is. Both live in the
          bar the period screens use, so the controls are where the hand
          already goes. */}
      <PeriodNav
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        label={`${start} ~ ${to}`}
        prevLabel={t("common.prevWindow")}
        nextLabel={t("common.nextWindow")}
        units={[
          { label: t("common.unitMonth"), href: unitHref("month"), active: !byYear },
          { label: t("common.unitYear"), href: unitHref("year"), active: byYear },
        ]}
      />

      <section>
        <SectionLabel>{trendLabel}</SectionLabel>
        <Card>
          {hasHistory ? (
            <div className="px-2 py-3 md:px-4">
              <NetIncomeChart
                points={points}
                currency={section.baseCurrency}
                locale={locale}
                tableCaption={trendLabel}
                labels={{
                  income: t("income.totalIncome"),
                  expense: t("income.totalExpense"),
                  net: t("income.netIncome"),
                  table: t("common.viewTable"),
                  period: t("income.period"),
                }}
              />
            </div>
          ) : (
            <EmptyState>{t("assets.noHistory")}</EmptyState>
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>{t("series.section")}</SectionLabel>
        <Card>
          {reportSeries.length === 0 ? (
            <EmptyState>{t("series.none")}</EmptyState>
          ) : (
            <div className="px-2 py-3 md:px-4">
              <SeriesChart
                periods={seriesMonths}
                ticks={seriesMonths.map((m) => m.slice(2).replace("-", "."))}
                series={reportSeries}
                initial={initialSeries}
                persistAs={seriesCookie}
                currency={section.baseCurrency}
                locale={locale}
                caption={t("series.section")}
                labels={{
                  table: t("common.viewTable"),
                  period: t("income.period"),
                  empty: t("series.noneOn"),
                  capped: t("series.capped"),
                }}
              />
            </div>
          )}
        </Card>
        <Hint>{t("series.hint")}</Hint>
      </section>

      {/* Back to the statement for the month the range ends in, not for
          the range: 기간손익 is a list of accounts, and a twelve-month
          one answers a different question than the chart just did. */}
      <Link
        href={`/income?${new URLSearchParams(monthRange(yearMonthOf(to)))}`}
        className={buttonClass("ghost")}
      >
        ← {t("assets.backToList")}
      </Link>
    </div>
  );
}
