import { cookies } from "next/headers";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, formulas } from "@/db/schema";
import { currentSection } from "@/lib/current-request";
import { addMonths, monthsBetween, shiftWindow, today, yearMonthOf } from "@/lib/date";
import { getMonthlySavings } from "@/lib/savings";
import { projectNetWorth } from "@/lib/net-worth-projection";
import { parseGroupOrder } from "@/lib/account-groups";
import { getAccountBalances, getMonthlyBalanceSheet } from "@/lib/ledger";
import { DEFAULT_SERIES, parseSeries, seriesCookieName } from "@/lib/chart-series";
import { buildReportSeries } from "@/lib/report-series";
import { formatMoney } from "@/lib/money";
import { CompositionChart } from "../../_components/composition-chart";
import { formulaTotalLabels } from "../../_components/formula-section";
import { NetWorthChart } from "../../_components/net-worth-chart";
import { SeriesChart } from "../../_components/series-chart";
import { PeriodNav } from "../../_components/period-nav";
import {
  buttonClass,
  Card,
  EmptyState,
  Hint,
  PageHeader,
  SectionLabel,
} from "../../_components/ui";

/** How far back the range reaches when nothing is asked for. */
const DEFAULT_MONTHS = 12;

export default async function AssetsChartPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const { from: fromParam, to: toParam } = await searchParams;

  // The range was a fixed twelve months with only its end movable, which
  // could not answer "how did this year compare with last" at all.
  const to = toParam ?? today(section.timezone);
  const from = fromParam ?? `${addMonths(yearMonthOf(to), -(DEFAULT_MONTHS - 1))}-01`;

  const start = from > to ? to : from;
  const months = monthsBetween(start, to);
  const currentMonth = yearMonthOf(today(section.timezone));
  // Only the months ahead. The balance sheet already speaks for the rest,
  // and since every month asked for here is in the future, none of them
  // reads the ledger — which is why the book's first month never comes
  // into it.
  const aheadMonths = months.filter((m) => m > currentMonth);
  const [history, savings, balances, catalog, formulaRows] = await Promise.all([
    getMonthlyBalanceSheet(db, { sectionId: section.id, months }),
    getMonthlySavings(db, {
      sectionId: section.id,
      months: aheadMonths,
      currentMonth,
      firstLedgerMonth: null,
    }),
    // The mix is a level, so it needs one instant rather than a span:
    // the end of the range on screen.
    getAccountBalances(db, { sectionId: section.id, asOf: to }),
    db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    }),
    db.query.formulas.findMany({
      where: and(eq(formulas.sectionId, section.id), eq(formulas.scope, "assets")),
      orderBy: asc(formulas.sortOrder),
    }),
  ]);
  // Only accounts actually holding something: a zero-length bar is a row
  // that says nothing and pushes the ones that matter down the page.
  const assetSlices = balances
    .filter((b) => b.group === "asset" && b.baseAmount > 0)
    .sort((a, b) => b.baseAmount - a.baseAmount)
    .map((b) => ({ id: b.accountId, name: b.name, amount: b.baseAmount }));

  // The balance sheet as it stands, plus what the budget expects of the
  // months it has not settled yet.
  const points = projectNetWorth({ history, savings, currentMonth });
  const hasHistory = points.some((p) => p.assets !== 0 || p.liabilities !== 0);
  const unsettled = points.some((p) => p.ahead);

  const seriesMonths = months;
  const reportSeries = await buildReportSeries(db, {
    sectionId: section.id,
    scope: "assets",
    months: seriesMonths,
    baseCurrency: section.baseCurrency,
    groupOrder: parseGroupOrder(section.groupOrder),
    accounts: catalog,
    formulas: formulaRows,
    totalLabels: formulaTotalLabels("assets", t),
  });

  // The window moves by its own length: paging back from twelve months
  // lands on the twelve before, not on eleven of the same twelve.
  const stepHref = (delta: number) => {
    const next = shiftWindow(start, to, delta);
    return `/assets/chart?from=${next.from}&to=${next.to}`;
  };
  const latest = history[history.length - 1];

  // The legend's on/off choice, as it was left. Kept in a cookie and read
  // here rather than restored on the client, so the page renders with the
  // right series already on — 이전/다음 기간 is an ordinary navigation, and
  // a chart that reset itself on every step was the complaint.
  const seriesCookie = seriesCookieName("assets");
  const stored = parseSeries(
    (await cookies()).get(seriesCookie)?.value,
    reportSeries.map((s) => s.key),
  );
  const initialSeries = stored ?? reportSeries.slice(0, DEFAULT_SERIES).map((s) => s.key);

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.assetsChart")} />

      <Card>
        <div className="px-4 py-4">
          <div className="text-ink-faint text-xs tracking-wide">{t("assets.netWorth")}</div>
          <div className="mt-1 text-[2rem] leading-tight font-bold tracking-tighter">
            {formatMoney(latest?.netWorth ?? 0, section.baseCurrency, locale)}
          </div>
        </div>
      </Card>

      {/* Same bar, same label, same picker as 기간손익 그래프 — the two
          chart screens read the same kind of period and had no business
          asking for it two different ways. */}
      <PeriodNav
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        label={`${start} ~ ${to}`}
        prevLabel={t("common.prevWindow")}
        nextLabel={t("common.nextWindow")}
        shortPrev={t("common.prev")}
        shortNext={t("common.next")}
        jump={{
          kind: "range",
          from: start,
          to,
          hrefTemplate: "/assets/chart?from={from}&to={to}",
          label: t("common.pickRange"),
          fromLabel: t("assets.rangeFrom"),
          toLabel: t("assets.rangeTo"),
          confirmLabel: t("common.apply"),
          closeLabel: t("common.close"),
        }}
      />

      <section>
        <SectionLabel>{t("assets.netWorthTrend")}</SectionLabel>
        <Card>
          {hasHistory ? (
            <div className="px-2 py-3 md:px-4">
              <NetWorthChart
                points={points}
                currency={section.baseCurrency}
                locale={locale}
                tableCaption={t("assets.netWorthTrend")}
                tableLabel={t("common.viewTable")}
                assetsLabel={t("group.asset")}
                liabilitiesLabel={t("group.liability")}
                netWorthLabel={t("assets.netWorth")}
                projectedLabel={t("assets.projectedNetWorth")}
                projectedMarker={t("assets.projected")}
                aheadMarker={t("assets.notSettled")}
              />
            </div>
          ) : (
            <EmptyState>{t("assets.noHistory")}</EmptyState>
          )}
        </Card>
        {/* Only when there is a broken stretch to explain. A standing
            note under a chart that is entirely history is one more line
            to read past. */}
        {unsettled && <Hint>{t("assets.projectedHint")}</Hint>}
      </section>

      <section>
        <SectionLabel>{t("assets.composition")}</SectionLabel>
        <Card>
          {assetSlices.length > 0 ? (
            <CompositionChart
              slices={assetSlices}
              currency={section.baseCurrency}
              locale={locale}
              shareLabel={t("assets.share")}
            />
          ) : (
            <EmptyState>{t("assets.empty")}</EmptyState>
          )}
        </Card>
        {/* The two charts above span the range; this one is a snapshot,
            and saying so is cheaper than letting the reader assume it
            averages the period. */}
        <Hint>{t("assets.compositionAsOf")}</Hint>
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
                settledThrough={currentMonth}
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
                  notSettled: t("assets.notSettled"),
                }}
              />
            </div>
          )}
        </Card>
        <Hint>{t("series.hint")}</Hint>
      </section>

      <Link href={`/assets?asOf=${to}`} className={buttonClass("nav")}>
        ← {t("assets.backToList")}
      </Link>
    </div>
  );
}
