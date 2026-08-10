import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, formulas } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { addMonths, monthsBetween, shiftWindow, today, yearMonthOf } from "@/lib/date";
import { parseGroupOrder } from "@/lib/account-groups";
import { getAccountBalances, getMonthlyBalanceSheet } from "@/lib/ledger";
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
  controlClass,
  EmptyState,
  Hint,
  Label,
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
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { from: fromParam, to: toParam } = await searchParams;

  // The range was a fixed twelve months with only its end movable, which
  // could not answer "how did this year compare with last" at all.
  const to = toParam ?? today(section.timezone);
  const from = fromParam ?? `${addMonths(yearMonthOf(to), -(DEFAULT_MONTHS - 1))}-01`;

  const start = from > to ? to : from;
  const months = monthsBetween(start, to);
  const [history, balances, catalog, formulaRows] = await Promise.all([
    getMonthlyBalanceSheet(db, { sectionId: section.id, months }),
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

  const hasHistory = history.some((h) => h.assets !== 0 || h.liabilities !== 0);

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

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.assetsChart")}>
        <form className="flex flex-wrap items-end gap-2" action="/assets/chart">
          <div>
            <Label>{t("assets.rangeFrom")}</Label>
            <input type="date" name="from" defaultValue={from} className={`${controlClass} tnum`} />
          </div>
          <div>
            <Label>{t("assets.rangeTo")}</Label>
            <input type="date" name="to" defaultValue={to} className={`${controlClass} tnum`} />
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            {t("common.apply")}
          </button>
        </form>
      </PageHeader>

      <Card>
        <div className="px-4 py-4">
          <div className="text-ink-faint text-xs tracking-wide">{t("assets.netWorth")}</div>
          <div className="mt-1 text-[2rem] leading-tight font-bold tracking-tighter">
            {formatMoney(latest?.netWorth ?? 0, section.baseCurrency, locale)}
          </div>
        </div>
      </Card>

      <PeriodNav
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        label={`${start} ~ ${to}`}
        prevLabel={t("common.prevWindow")}
        nextLabel={t("common.nextWindow")}
      />

      <section>
        <SectionLabel>{t("assets.netWorthTrend")}</SectionLabel>
        <Card>
          {hasHistory ? (
            <div className="px-2 py-3 md:px-4">
              <NetWorthChart
                points={history}
                currency={section.baseCurrency}
                locale={locale}
                tableCaption={t("assets.netWorthTrend")}
                tableLabel={t("common.viewTable")}
                assetsLabel={t("group.asset")}
                liabilitiesLabel={t("group.liability")}
                netWorthLabel={t("assets.netWorth")}
              />
            </div>
          ) : (
            <EmptyState>{t("assets.noHistory")}</EmptyState>
          )}
        </Card>
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
                ticks={seriesMonths.map((m) => m.slice(2).replace("-", "."))}
                series={reportSeries}
                initial={reportSeries.slice(0, 2).map((s) => s.key)}
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

      <Link href={`/assets?asOf=${to}`} className={buttonClass("ghost")}>
        ← {t("assets.backToList")}
      </Link>
    </div>
  );
}
