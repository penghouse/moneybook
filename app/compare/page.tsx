import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, type AccountGroup } from "@/db/schema";
import type { TranslationKey } from "@/i18n";
import { GROUP_LABEL_KEY } from "@/i18n/groups";
import { parseGroupOrder } from "@/lib/account-groups";
import {
  baselineRange,
  COMPARE_BASELINES,
  parseBaseline,
  parseScope,
  type CompareBaseline,
  type CompareScope,
} from "@/lib/compare-period";
import { compareAccounts } from "@/lib/compare-rows";
import { currentSection } from "@/lib/current-request";
import { monthRange, rangeLabel, shiftWindow, today, yearMonthOf } from "@/lib/date";
import { getAccountBalances, getAccountFlows } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { PeriodNav } from "../_components/period-nav";
import { Card, EmptyState, Hint, PageHeader, SectionLabel } from "../_components/ui";

/**
 * What each baseline is called.
 *
 * Spelled out rather than built as `compare.${option}`: the template
 * happened to typecheck against 「compare.previous」, which is the *column*
 * heading — the chip would have read 「이전」 where it meant 「직전기간」.
 */
const BASELINE_LABEL: Record<CompareBaseline, TranslationKey> = {
  previous: "compare.previousPeriod",
  year1: "compare.year1",
  year2: "compare.year2",
  year3: "compare.year3",
  year4: "compare.year4",
  year5: "compare.year5",
};

/** Which 분류 each scope compares, in the order the book lists them. */
const SCOPE_GROUPS: Record<CompareScope, AccountGroup[]> = {
  flow: ["income", "expense"],
  balance: ["asset", "liability"],
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; scope?: string; against?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const params = await searchParams;

  const now = today(section.timezone);
  const thisMonth = monthRange(yearMonthOf(now));
  const to = params.to ?? thisMonth.to;
  const from = params.from ?? thisMonth.from;
  const start = from > to ? to : from;

  const scope = parseScope(params.scope);
  const against = parseBaseline(params.against);
  const previous = baselineRange(start, to, against);

  const groupOrder = parseGroupOrder(section.groupOrder).filter((group) =>
    SCOPE_GROUPS[scope].includes(group),
  );

  const [catalog, previousAmounts, currentAmounts] = await Promise.all([
    db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    }),
    // 비용·수익 is what moved over a span; 자산·부채 is what stood at an
    // instant. Comparing a balance over a range, or a flow at a date,
    // would answer a question nobody asked.
    scope === "flow"
      ? getAccountFlows(db, { sectionId: section.id, from: previous.from, to: previous.to })
      : getAccountBalances(db, { sectionId: section.id, asOf: previous.to }),
    scope === "flow"
      ? getAccountFlows(db, { sectionId: section.id, from: start, to })
      : getAccountBalances(db, { sectionId: section.id, asOf: to }),
  ]);

  const groups = compareAccounts({
    accounts: catalog,
    previous: previousAmounts,
    current: currentAmounts,
    groupOrder,
  });

  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);
  const href = (next: { from?: string; to?: string; scope?: string; against?: string }) => {
    const query = new URLSearchParams({
      from: next.from ?? start,
      to: next.to ?? to,
      scope: next.scope ?? scope,
      against: next.against ?? against,
    });
    return `/compare?${query}`;
  };

  const stepHref = (delta: number) => href(shiftWindow(start, to, delta));
  const heading = scope === "flow" ? t("compare.flow") : t("compare.balance");

  /**
   * A name, and the three figures under it.
   *
   * Stacked rather than in a row beside the name: three won amounts of
   * eight or ten glyphs each do not fit a phone's width next to a label,
   * and squeezing them truncated the one word that says what the figures
   * are about — 「비용」 came out as 「비...」. A line each keeps every
   * figure whole and the columns aligned down the card.
   */
  const Line = ({
    name,
    row,
    strong = false,
  }: {
    name: string;
    row: { previous: number; current: number; change: number };
    strong?: boolean;
  }) => (
    <>
      <div className={`min-w-0 truncate ${strong ? "font-bold" : "text-sm"}`}>{name}</div>
      <div className="tnum mt-0.5 grid grid-cols-3 gap-x-2 text-right text-sm">
        <span className="text-ink-faint truncate">{base(row.previous)}</span>
        <span className={`truncate ${strong ? "font-bold" : "font-semibold"}`}>
          {base(row.current)}
        </span>
        <span
          className={`truncate font-semibold ${
            row.change > 0 ? "text-positive" : row.change < 0 ? "text-negative" : "text-ink-faint"
          }`}
        >
          {row.change > 0 ? "+" : ""}
          {base(row.change)}
        </span>
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.compare")} />

      <PeriodNav
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        label={rangeLabel(start, to)}
        prevLabel={t("common.prevWindow")}
        nextLabel={t("common.nextWindow")}
        shortPrev={t("common.prev")}
        shortNext={t("common.next")}
        jump={{
          kind: "range",
          from: start,
          to,
          hrefTemplate: `/compare?from={from}&to={to}&scope=${scope}&against=${against}`,
          label: t("common.pickRange"),
          fromLabel: t("assets.rangeFrom"),
          toLabel: t("assets.rangeTo"),
          confirmLabel: t("common.apply"),
          closeLabel: t("common.close"),
        }}
        units={[
          { label: t("compare.flow"), href: href({ scope: "flow" }), active: scope === "flow" },
          {
            label: t("compare.balance"),
            href: href({ scope: "balance" }),
            active: scope === "balance",
          },
        ]}
      />

      <section>
        <SectionLabel>{t("compare.against")}</SectionLabel>
        <Card>
          {/* Scrolled rather than wrapped: six choices at a touch size do
              not fit a phone's width, and a wrapped row of them takes
              more of the screen than the table it is a control for. */}
          <div className="flex gap-1 overflow-x-auto px-1 py-1" data-testid="compare-against">
            {COMPARE_BASELINES.map((option) => (
              <a
                key={option}
                href={href({ against: option })}
                aria-current={option === against ? "page" : undefined}
                data-testid={`compare-against-${option}`}
                className={`rounded-control inline-flex min-h-11 shrink-0 items-center border px-3 text-sm ${
                  option === against
                    ? "border-accent bg-accent text-accent-ink font-semibold"
                    : "text-ink-muted hover:bg-sunken border-transparent"
                }`}
              >
                {t(BASELINE_LABEL[option])}
              </a>
            ))}
          </div>
        </Card>
        <Hint>
          {previous.from} ~ {previous.to}
        </Hint>
      </section>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <SectionLabel>{heading}</SectionLabel>
          <span className="text-ink-faint grid shrink-0 grid-cols-3 gap-x-2 text-right text-[11px]">
            <span>{t("compare.previous")}</span>
            <span>{t("compare.current")}</span>
            <span>{t("compare.change")}</span>
          </span>
        </div>

        {groups.length === 0 ? (
          <Card>
            <EmptyState>{t("compare.empty")}</EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <Card key={group.group}>
                <div data-testid="compare-group" className="border-rule-soft border-b px-4 py-3">
                  <Line name={t(GROUP_LABEL_KEY[group.group])} row={group} strong />
                </div>

                {group.bands.map((band) => (
                  <div key={band.category ?? " uncategorized"}>
                    {group.bands.length > 1 && (
                      <div className="bg-sunken border-rule-soft flex items-baseline justify-between gap-3 border-t px-4 py-1.5">
                        <span className="text-ink-muted min-w-0 truncate text-xs font-semibold">
                          {band.category ?? t("accounts.uncategorized")}
                        </span>
                        <span className="tnum text-ink-muted text-xs font-semibold">
                          {band.change > 0 ? "+" : ""}
                          {base(band.change)}
                        </span>
                      </div>
                    )}
                    {band.rows.map((row) => (
                      <div
                        key={row.accountId}
                        data-testid="compare-row"
                        className="border-rule-soft border-t px-4 py-3"
                      >
                        <Line name={row.name} row={row} />
                      </div>
                    ))}
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )}
        <Hint>{scope === "flow" ? t("compare.flowHint") : t("compare.balanceHint")}</Hint>
      </section>
    </div>
  );
}
