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
  Label,
  PageHeader,
  SectionLabel,
} from "../../_components/ui";

const MONTHS = 12;

export default async function AssetsChartPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { asOf: asOfParam } = await searchParams;
  const asOf = asOfParam ?? today(section.timezone);

  const currentYearMonth = yearMonthOf(asOf);
  const months = Array.from({ length: MONTHS }, (_, i) =>
    addMonths(currentYearMonth, i - (MONTHS - 1)),
  );
  const history = await getMonthlyBalanceSheet(db, { sectionId: section.id, months });

  const balances = await getAccountBalances(db, { sectionId: section.id, asOf });
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
            <Label>{t("assets.asOf")}</Label>
            <input type="date" name="asOf" defaultValue={asOf} className={`${controlClass} tnum`} />
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            {t("entry.filterApply")}
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
      </section>

      <Link href={`/assets?asOf=${asOf}`} className={buttonClass("ghost")}>
        ← {t("assets.backToList")}
      </Link>
    </div>
  );
}
