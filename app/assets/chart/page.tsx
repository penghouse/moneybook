import Link from "next/link";
import { db } from "@/db/client";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { addMonths, today, yearMonthOf } from "@/lib/date";
import { getAccountBalances, getMonthlyBalanceSheet } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { CompositionChart } from "../../_components/composition-chart";
import { NetWorthChart } from "../../_components/net-worth-chart";
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

/** Every month from `from` to `to` inclusive, oldest first. */
function monthsBetween(from: string, to: string): string[] {
  const first = yearMonthOf(from);
  const last = yearMonthOf(to);
  const months: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    months.push(m);
    // A reversed range would otherwise spin forever; the form guards
    // against it too, but a hand-typed query string does not go through
    // the form.
    if (months.length > 600) break;
  }
  return months;
}

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

  const months = monthsBetween(from > to ? to : from, to);
  const history = await getMonthlyBalanceSheet(db, { sectionId: section.id, months });

  // The mix is a level, so it needs one instant rather than a span: the
  // end of the range on screen.
  const balances = await getAccountBalances(db, { sectionId: section.id, asOf: to });
  // Only accounts actually holding something: a zero-length bar is a row
  // that says nothing and pushes the ones that matter down the page.
  const assetSlices = balances
    .filter((b) => b.group === "asset" && b.baseAmount > 0)
    .sort((a, b) => b.baseAmount - a.baseAmount)
    .map((b) => ({ id: b.accountId, name: b.name, amount: b.baseAmount }));

  const hasHistory = history.some((h) => h.assets !== 0 || h.liabilities !== 0);
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

      <Link href={`/assets?asOf=${to}`} className={buttonClass("ghost")}>
        ← {t("assets.backToList")}
      </Link>
    </div>
  );
}
