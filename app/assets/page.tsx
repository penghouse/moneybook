import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { accounts, formulas } from "@/db/schema";
import { getTranslations, type TranslationKey } from "@/i18n";
import { isClosedBy } from "@/lib/accounts";
import { parseGroupOrder } from "@/lib/account-groups";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import {
  addMonthsToDate,
  addYearsToDate,
  monthRange,
  today,
  yearMonthOf,
  yearOf,
  yearRange,
} from "@/lib/date";
import { buildFormulaItems } from "@/lib/formula-items";
import { getAccountBalances, getUnrealizedFx } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { FormulaSection, formulaTotalLabels } from "../_components/formula-section";
import { PeriodNav } from "../_components/period-nav";
import { SubmitButton } from "../_components/submit-button";
import {
  buttonClass,
  Card,
  Chip,
  controlClass,
  EmptyState,
  Hint,
  KeyValueRow,
  Label,
  Money,
  PageHeader,
  SectionLabel,
} from "../_components/ui";
import { revalueAction } from "./actions";

const GROUP_LABEL_KEY: Record<"asset" | "liability", TranslationKey> = {
  asset: "group.asset",
  liability: "group.liability",
};

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; revalued?: string; step?: string }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { asOf: asOfParam, revalued, step: stepParam } = await searchParams;
  const now = today(section.timezone);
  const asOf = asOfParam ?? now;

  /**
   * A balance sheet is read at an instant, and an instant cannot say
   * what unit it belongs to — 12월 31일 is a month end and a year end
   * at once. So unlike the income statement, whose unit is derived from
   * its range, this one has to be told, and it is carried in the URL so
   * a bookmark or a back-button press keeps the arrows stepping the way
   * they were.
   */
  const step = stepParam === "year" ? "year" : "month";
  const { from: periodFrom, to: periodTo } =
    step === "year" ? yearRange(yearOf(asOf)) : monthRange(yearMonthOf(asOf));

  const balances = await getAccountBalances(db, {
    sectionId: section.id,
    asOf,
  });

  // Windows only — the balances themselves come from the ledger and are
  // never filtered by the catalog.
  const sectionAccounts = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
    columns: { id: true, activeFrom: true, activeTo: true },
  });
  const windowOf = new Map(sectionAccounts.map((a) => [a.id, a]));

  /**
   * Retired accounts that have been emptied out, folded away.
   *
   * The condition is deliberately `balance is zero` **and** closed, not
   * closed alone. A balance is a fact; an account's active window is a
   * catalog note about it, and letting the note hide a fact is how a
   * balance sheet silently stops adding up — a card closed while still
   * carrying debt, or a stray transaction imported onto a closed
   * account, would take real money off the total with nothing on screen
   * to say so.
   *
   * Gating on zero makes that impossible rather than merely unlikely:
   * only rows contributing exactly 0 are ever dropped, so no total can
   * move. If money does land on a closed account, its row reappears —
   * loudly wrong beats quietly wrong.
   *
   * `isClosedBy(asOf)`, not `today`: viewing the sheet as of a past date
   * shows the accounts that were live then.
   */
  const retired = (b: (typeof balances)[number]) => {
    if (b.baseAmount !== 0 || b.amount !== 0) return false;
    const account = windowOf.get(b.accountId);
    return account !== undefined && isClosedBy(account, asOf);
  };

  const assets = balances.filter((b) => b.group === "asset");
  const liabilities = balances.filter((b) => b.group === "liability");
  const totalAssets = assets.reduce((s, a) => s + a.baseAmount, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.baseAmount, 0);
  const netWorth = totalAssets - totalLiabilities;
  const visibleAssets = assets.filter((a) => !retired(a));
  const visibleLiabilities = liabilities.filter((a) => !retired(a));

  const fx = await getUnrealizedFx(db, {
    sectionId: section.id,
    baseCurrency: section.baseCurrency,
    asOf,
  });
  const fxByAccountId = new Map(fx.map((f) => [f.accountId, f]));
  const hasUnrealized = fx.some((f) => !f.rateUnavailable && f.unrealized !== 0);

  // One entry per currency, not just the first account's — with several
  // foreign currencies their rates can resolve to different dates (a
  // fallback to the last cached rate, or a weekend rolling back to the
  // previous business day), and showing only one would misdate the rest.
  const rateDates = [
    ...new Map(
      fx
        .filter((f) => !f.rateUnavailable)
        .map((f) => [
          f.currency,
          { currency: f.currency, date: f.rateDate, isFallback: f.isFallback },
        ]),
    ).values(),
  ];
  const unavailableCurrencies = [
    ...new Set(fx.filter((f) => f.rateUnavailable).map((f) => f.currency)),
  ];

  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);

  function renderGroup(group: "asset" | "liability", list: typeof balances) {
    return (
      <section key={group}>
        <SectionLabel>{t(GROUP_LABEL_KEY[group])}</SectionLabel>
        <Card>
          {list.length === 0 ? (
            <EmptyState>{t("assets.empty")}</EmptyState>
          ) : (
            list.map((a) => {
              const f = fxByAccountId.get(a.accountId);
              return (
                <KeyValueRow
                  key={a.accountId}
                  // "왜 이 숫자지" is answered by the transactions behind
                  // it, so the row opens the period on screen filtered to
                  // this account. The balance is cumulative to 기준일
                  // while the list is one period — the link answers what
                  // moved it lately, not how it got to where it is.
                  href={`/?accountId=${a.accountId}&from=${periodFrom}&to=${periodTo}`}
                  label={a.name}
                  value={<Money amount={a.amount} currency={a.currency} locale={locale} />}
                  // Only foreign-currency accounts carry a book/current
                  // split; for base-currency accounts the two are the same
                  // number and the chips would be noise.
                  sub={
                    f && (
                      <>
                        <Chip>
                          {t("assets.book")} {base(f.bookBaseAmount)}
                        </Chip>
                        {f.rateUnavailable ? (
                          <Chip tone="warning">{t("assets.rateUnavailable")}</Chip>
                        ) : (
                          <>
                            <Chip>
                              {t("assets.current")} {base(f.currentBaseAmount)}
                            </Chip>
                            {f.unrealized !== 0 && (
                              <Chip tone={f.unrealized > 0 ? "positive" : "negative"}>
                                {t("assets.unrealized")} {f.unrealized > 0 ? "+" : ""}
                                {base(f.unrealized)}
                              </Chip>
                            )}
                          </>
                        )}
                      </>
                    )
                  }
                />
              );
            })
          )}
        </Card>
      </section>
    );
  }

  // Assets before liabilities, or the other way round — whichever the
  // book was set to on /accounts.
  const groupOrder = parseGroupOrder(section.groupOrder).filter(
    (g): g is "asset" | "liability" => g === "asset" || g === "liability",
  );

  /**
   * The 계산식 band's inputs, built from the same balances the sheet
   * above prints — so a formula naming 「유동성자금」 can only ever mean
   * the 유동성자금 on this screen, at this 기준일.
   */
  const formulaCatalog = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
    orderBy: asc(accounts.sortOrder),
    columns: { id: true, name: true, group: true, category: true },
  });
  const formulaItems = buildFormulaItems({
    scope: "assets",
    groupOrder: parseGroupOrder(section.groupOrder),
    accounts: formulaCatalog,
    amountByAccountId: new Map(balances.map((b) => [b.accountId, b.baseAmount])),
    labels: { totals: formulaTotalLabels("assets", t) },
  });
  const formulaRows = await db.query.formulas.findMany({
    where: and(eq(formulas.sectionId, section.id), eq(formulas.scope, "assets")),
    orderBy: asc(formulas.sortOrder),
  });

  const assetsHref = (date: string, unit: "month" | "year") => `/assets?asOf=${date}&step=${unit}`;
  const stepHref = (delta: number) =>
    assetsHref(step === "year" ? addYearsToDate(asOf, delta) : addMonthsToDate(asOf, delta), step);

  // Switching to years snaps to that year's end, because "as of some day
  // in August" is not the question anyone asks a yearly balance sheet —
  // capped at today, so the current year lands on today rather than on a
  // 12월 31일 that has not happened. Switching back to months keeps the
  // date, which is where the reader already is.
  const units = [
    { label: t("common.unitMonth"), href: assetsHref(asOf, "month"), active: step === "month" },
    {
      label: t("common.unitYear"),
      href: assetsHref(yearRange(yearOf(asOf)).to > now ? now : yearRange(yearOf(asOf)).to, "year"),
      active: step === "year",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.assets")}>
        <Link href={`/assets/chart?to=${asOf}`} className={buttonClass("secondary")}>
          {t("assets.viewCharts")}
        </Link>
        <form className="flex items-end gap-2" action="/assets">
          <div>
            <Label>{t("assets.asOf")}</Label>
            <input type="date" name="asOf" defaultValue={asOf} className={`${controlClass} tnum`} />
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            {t("common.apply")}
          </button>
        </form>
      </PageHeader>

      {/* The arrows move the instant itself rather than stepping through
          periods. The day is kept where the target month has one, so
          stepping back from the 31st does not land on the 3rd of the
          month after. */}
      <PeriodNav
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        label={asOf}
        prevLabel={step === "year" ? t("common.prevYear") : t("common.prevMonth")}
        nextLabel={step === "year" ? t("common.nextYear") : t("common.nextMonth")}
        units={units}
      />

      {revalued === "1" && (
        <p className="bg-positive-soft text-positive rounded-control px-3 py-2 text-sm">
          {t("assets.revalueDone")}
        </p>
      )}

      <Card>
        <div className="px-4 py-4">
          <div className="text-ink-faint text-xs tracking-wide">{t("assets.netWorth")}</div>
          <div className="tnum mt-1 mb-3.5 text-[2rem] leading-tight font-bold tracking-tighter">
            {base(netWorth)}
          </div>
          <div className="text-ink-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              {t("assets.totalAssets")}{" "}
              <b className="tnum text-ink font-semibold">{base(totalAssets)}</b>
            </span>
            <span>
              {t("assets.totalLiabilities")}{" "}
              <b className="tnum text-ink font-semibold">{base(totalLiabilities)}</b>
            </span>
          </div>
        </div>
        <p className="border-rule-soft text-ink-faint border-t px-4 py-2.5 text-xs">
          {t("assets.totalsAreBookValue")}
        </p>
      </Card>

      {/* Directly under the totals, because the card above ends by
          saying they are book value and to press this — which was true
          only after scrolling past every account. The FX notes come with
          it: a rate date explains the number the button would post. */}
      <section>
        <form action={revalueAction}>
          <input type="hidden" name="asOf" value={asOf} />
          <SubmitButton
            variant="primary"
            full
            disabled={!hasUnrealized}
            pendingLabel={t("common.working")}
          >
            {t("assets.revalue")}
          </SubmitButton>
        </form>
        {!hasUnrealized && <Hint>{t("assets.noUnrealized")}</Hint>}
        {rateDates.length > 0 && (
          <Hint>
            {t("assets.rateDate")} ·{" "}
            {rateDates
              .map(
                (r) =>
                  `${r.currency} ${r.date}${r.isFallback ? ` (${t("assets.rateFallback")})` : ""}`,
              )
              .join(" · ")}
          </Hint>
        )}
        {unavailableCurrencies.length > 0 && (
          <p className="text-warning mt-1.5 text-xs">
            {t("assets.rateUnavailable")}: {unavailableCurrencies.join(", ")}
          </p>
        )}
      </section>

      {groupOrder.map((group) =>
        renderGroup(group, group === "asset" ? visibleAssets : visibleLiabilities),
      )}

      <FormulaSection
        scope="assets"
        rows={formulaRows}
        items={formulaItems}
        currency={section.baseCurrency}
        locale={locale}
        t={t}
      />
    </div>
  );
}
