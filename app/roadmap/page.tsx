import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, formulas, roadmaps, roadmapYears, transactions } from "@/db/schema";
import { parseGroupOrder } from "@/lib/account-groups";
import { currentSection } from "@/lib/current-request";
import { monthsBetween, today, yearMonthOf, yearOf } from "@/lib/date";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { buildReportSeries } from "@/lib/report-series";
import { getMonthlySavings, sumSavings, type MonthlySaving } from "@/lib/savings";
import { buildRoadmap, MAX_ROADMAP_YEARS, roadmapYearList, type RoadmapRow } from "@/lib/roadmap";
import { formulaTotalLabels } from "../_components/formula-section";
import { DialogActionForm, RowDialog } from "../_components/dialog";
import { SubmitButton } from "../_components/submit-button";
import {
  buttonClass,
  Card,
  Chip,
  controlClass,
  EmptyState,
  Hint,
  Label,
  Money,
  PageHeader,
} from "../_components/ui";
import { deleteRoadmapAction, saveRoadmapAction, setRoadmapYearAction } from "./actions";
import { RoadmapImage } from "./roadmap-image";
import { TurnToRead } from "./turn-to-read";

/** Percent in the boxes, multiplier in the table — see actions.ts. */
const asPercent = (rate: number) => Math.round(rate * 10000) / 100;

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    new?: string;
    edit?: string;
    year?: string;
    error?: string;
  }>;
}) {
  const { section, t, locale } = await currentSection();
  const params = await searchParams;

  const [versions, formulaRows] = await Promise.all([
    db.query.roadmaps.findMany({
      where: eq(roadmaps.sectionId, section.id),
      orderBy: asc(roadmaps.sortOrder),
    }),
    db.query.formulas.findMany({
      where: and(eq(formulas.sectionId, section.id), eq(formulas.scope, "assets")),
      orderBy: asc(formulas.sortOrder),
    }),
  ]);

  // Falls back to the first version rather than to an empty screen: a
  // reader arriving at /roadmap wants the roadmap, not a chooser.
  const selected = params.id ? versions.find((v) => v.id === params.id) : versions[0];
  const isNew = params.new === "1";
  const editing = params.edit === "1" && selected ? selected : undefined;
  const money = (minor: number) => formatMoney(minor, section.baseCurrency, locale);
  const major = (minor: number) => String(toMajorUnits(minor, section.baseCurrency));

  if (isNew || editing) {
    const thisYear = yearOf(today(section.timezone));
    const errors: Record<string, string> = {
      name: t("roadmap.nameRequired"),
      year: t("roadmap.yearInvalid"),
      range: t("roadmap.rangeBackwards"),
      span: t("roadmap.rangeTooLong").replace("{n}", String(MAX_ROADMAP_YEARS)),
    };

    return (
      <div className="space-y-4">
        <PageHeader title={editing ? t("roadmap.editVersion") : t("roadmap.addVersion")} />

        <form action={saveRoadmapAction} className="space-y-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <Card>
            <div className="space-y-3 px-4 py-4">
              <div>
                <Label htmlFor="roadmap-name">{t("roadmap.versionName")}</Label>
                <input
                  id="roadmap-name"
                  type="text"
                  name="name"
                  required
                  defaultValue={editing?.name ?? ""}
                  placeholder={t("roadmap.versionNamePlaceholder")}
                  className={controlClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="roadmap-start">{t("roadmap.startYear")}</Label>
                  <input
                    id="roadmap-start"
                    type="number"
                    name="startYear"
                    required
                    inputMode="numeric"
                    defaultValue={editing?.startYear ?? thisYear}
                    className={`${controlClass} tnum`}
                  />
                </div>
                <div>
                  <Label htmlFor="roadmap-end">{t("roadmap.endYear")}</Label>
                  <input
                    id="roadmap-end"
                    type="number"
                    name="endYear"
                    required
                    inputMode="numeric"
                    defaultValue={editing?.endYear ?? String(Number(thisYear) + 29)}
                    className={`${controlClass} tnum`}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="roadmap-starting">{t("roadmap.startingAmount")}</Label>
                <input
                  id="roadmap-starting"
                  type="number"
                  name="startingAmount"
                  step="any"
                  inputMode="decimal"
                  defaultValue={editing ? major(editing.startingAmount) : ""}
                  className={`${controlClass} tnum`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="roadmap-contribution">{t("roadmap.defaultContribution")}</Label>
                  <input
                    id="roadmap-contribution"
                    type="number"
                    name="defaultContribution"
                    step="any"
                    inputMode="decimal"
                    defaultValue={editing ? major(editing.defaultContribution) : ""}
                    className={`${controlClass} tnum`}
                  />
                </div>
                <div>
                  <Label htmlFor="roadmap-rate">{t("roadmap.defaultReturnRate")} (%)</Label>
                  <input
                    id="roadmap-rate"
                    type="number"
                    name="defaultReturnRate"
                    step="any"
                    inputMode="decimal"
                    defaultValue={editing ? String(asPercent(editing.defaultReturnRate)) : ""}
                    className={`${controlClass} tnum`}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="roadmap-formula">{t("roadmap.actualFormula")}</Label>
                <select
                  id="roadmap-formula"
                  name="actualFormulaId"
                  defaultValue={editing?.actualFormulaId ?? ""}
                  className={controlClass}
                >
                  <option value="">{t("roadmap.actualFormulaNone")}</option>
                  {formulaRows.map((formula) => (
                    <option key={formula.id} value={formula.id}>
                      {formula.name}
                    </option>
                  ))}
                </select>
                <Hint>
                  {formulaRows.length === 0
                    ? t("roadmap.actualFormulaEmpty")
                    : t("roadmap.actualFormulaHint")}
                </Hint>
              </div>

              {params.error && errors[params.error] && (
                <p className="text-negative text-sm">{errors[params.error]}</p>
              )}
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="primary" pendingLabel={t("common.saving")}>
              {t("common.save")}
            </SubmitButton>
            <Link
              href={editing ? `/roadmap?id=${editing.id}` : "/roadmap"}
              className={buttonClass("ghost")}
            >
              {t("common.cancel")}
            </Link>
          </div>
        </form>

        {editing && (
          // Its own form: a 삭제 inside the one above would submit the
          // edits it is throwing away.
          <form action={deleteRoadmapAction}>
            <input type="hidden" name="id" value={editing.id} />
            <SubmitButton variant="danger" pendingLabel={t("common.working")}>
              {t("common.delete")}
            </SubmitButton>
          </form>
        )}
      </div>
    );
  }

  const header = (
    <PageHeader title={t("roadmap.title")}>
      <Link href="/roadmap?new=1" className={buttonClass("primary")}>
        {t("roadmap.addVersion")}
      </Link>
    </PageHeader>
  );

  if (!selected) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <EmptyState>{t("roadmap.empty")}</EmptyState>
        </Card>
        <Hint>{t("roadmap.emptyHint")}</Hint>
      </div>
    );
  }

  const years = roadmapYearList(selected.startYear, selected.endYear);

  // The book's own beginning, asked for once and used twice: it is what
  // separates "the year was zero" from "the year is outside the book",
  // and both the actuals and the savings need that line drawn.
  const [{ first: firstEntry }] = await db
    .select({ first: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.sectionId, section.id));
  const firstLedgerMonth = firstEntry?.slice(0, 7) ?? null;
  const currentMonth = yearMonthOf(today(section.timezone));

  const [overrides, actualByYear, savings] = await Promise.all([
    db.query.roadmapYears.findMany({
      where: eq(roadmapYears.roadmapId, selected.id),
      orderBy: asc(roadmapYears.year),
    }),
    loadActuals(),
    years.length === 0
      ? Promise.resolve([])
      : getMonthlySavings(db, {
          sectionId: section.id,
          months: monthsBetween(`${years[0]}-01-01`, `${years[years.length - 1]}-12-31`),
          currentMonth,
          firstLedgerMonth,
        }),
  ]);

  /**
   * 연저축액, worked out rather than typed.
   *
   * A flat "I will save this much every year" is wrong the moment the
   * first year is over, and it was wrong about the past from the start.
   * The months know better: the ones behind us have real income and
   * spending in the ledger, and the ones ahead have budgets. So each
   * year is the sum of its twelve months, and only a year not one month
   * of which could be spoken for falls back to the flat figure — which
   * is what `sumSavings` returning null is for.
   */
  const savingsByYear = new Map<string, MonthlySaving[]>();
  for (const row of savings) {
    const year = row.month.slice(0, 4);
    const list = savingsByYear.get(year);
    if (list) list.push(row);
    else savingsByYear.set(year, [row]);
  }
  const contributionByYear = new Map<string, number>();
  const settledContributionByYear = new Map<string, number>();
  for (const [year, months] of savingsByYear) {
    const total = sumSavings(months);
    if (total !== null) contributionByYear.set(year, total);
    // Only the months already lived. The year in progress carries a
    // closing figure that is today's, so the rate read back out of it
    // has to stand on the saving actually made by today.
    settledContributionByYear.set(
      year,
      months.filter((m) => m.source === "actual").reduce((sum, m) => sum + m.saving, 0),
    );
  }

  /**
   * What the book says each year actually ended at.
   *
   * Read through `buildReportSeries` — the very function 자산현황's chart
   * uses — with December as the month, so the roadmap's 실적 column and
   * the formula band at the foot of the report cannot say different
   * things about the same year.
   *
   * Only years the ledger can speak for are asked about. A figure of
   * zero comes back for a year that is simply outside the book, and
   * printing that as "자산 0원" would be a claim the book never made.
   * The current year *is* included: December is in the future, balances
   * carry forward, so what comes back is where things stand today.
   */
  async function loadActuals(): Promise<Map<string, number>> {
    if (!selected?.actualFormulaId || !firstLedgerMonth) return new Map();

    const thisYear = yearOf(today(section.timezone));
    const known = years.filter((y) => y >= firstLedgerMonth.slice(0, 4) && y <= thisYear);
    if (known.length === 0) return new Map();

    const catalog = await db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    });
    const series = await buildReportSeries(db, {
      sectionId: section.id,
      scope: "assets",
      months: known.map((y) => `${y}-12`),
      baseCurrency: section.baseCurrency,
      groupOrder: parseGroupOrder(section.groupOrder),
      accounts: catalog,
      formulas: formulaRows,
      totalLabels: formulaTotalLabels("assets", t),
    });

    const chosen = series.find((s) => s.key === `formula:${selected.actualFormulaId}`);
    if (!chosen) return new Map();
    return new Map(known.map((year, i) => [year, chosen.values[i]]));
  }

  const rows = buildRoadmap({
    startYear: selected.startYear,
    endYear: selected.endYear,
    startingAmount: selected.startingAmount,
    defaultContribution: selected.defaultContribution,
    defaultReturnRate: selected.defaultReturnRate,
    overrides,
    actualByYear,
    contributionByYear,
    settledContributionByYear,
  });

  const cell = "px-3 py-2 whitespace-nowrap";
  const num = `${cell} tnum text-right`;

  const asked = params.year;
  if (asked && savingsByYear.has(asked)) {
    const months = savingsByYear.get(asked)!;
    const total = sumSavings(months);

    return (
      <div className="space-y-4">
        <PageHeader title={`${asked} ${t("roadmap.monthly")}`} />

        <Card>
          {/* The scroller is inside the card, not the card itself. A
              Card always carries overflow-hidden — that is what clips
              its rounded corners — so an overflow utility added
              alongside is two declarations of one property, and which
              of them wins is decided by Tailwind's emit order rather
              than by anything written here. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-rule-soft text-ink-faint border-b text-left">
                  <th scope="col" className={`${cell} font-medium`}>
                    {t("roadmap.month")}
                  </th>
                  <th scope="col" className={`${cell} text-right font-medium`}>
                    {t("roadmap.saving")}
                  </th>
                  <th scope="col" className={`${cell} text-right font-medium`}>
                    {t("budget.earned")}
                  </th>
                  <th scope="col" className={`${cell} text-right font-medium`}>
                    {t("budget.spent")}
                  </th>
                  <th scope="col" className={`${cell} font-medium`}>
                    {t("roadmap.source")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => (
                  <tr
                    key={month.month}
                    data-testid="roadmap-month"
                    className="border-rule-soft border-t"
                  >
                    <td className={`${cell} tnum p-0`}>
                      {/* Straight to the month it is short of a budget for
                        — the one thing a blank row wants doing about it. */}
                      <Link
                        href={`/budget?period=${month.month}`}
                        className="hover:bg-sunken flex min-h-12 items-center px-3 font-semibold"
                      >
                        {month.month}
                      </Link>
                    </td>
                    <td className={num}>
                      {month.blank ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <Money
                          amount={month.saving}
                          currency={section.baseCurrency}
                          locale={locale}
                          tone="signed"
                          showPlus
                        />
                      )}
                    </td>
                    <td className={`${num} text-ink-muted`}>
                      {month.blank ? "" : money(month.income)}
                    </td>
                    <td className={`${num} text-ink-muted`}>
                      {month.blank ? "" : money(month.expense)}
                    </td>
                    <td className={cell}>
                      {month.blank ? (
                        <Chip tone="warning">{t("roadmap.sourceNone")}</Chip>
                      ) : (
                        <Chip tone={month.source === "actual" ? "positive" : "default"}>
                          {t(
                            month.source === "actual"
                              ? "roadmap.sourceActual"
                              : "roadmap.sourceBudget",
                          )}
                        </Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-rule border-t-2">
                  <td className={`${cell} font-bold`}>{t("roadmap.total")}</td>
                  <td className={num} data-testid="roadmap-month-total">
                    {total === null ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <Money
                        amount={total}
                        currency={section.baseCurrency}
                        locale={locale}
                        tone="signed"
                        showPlus
                      />
                    )}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Hint>{t("roadmap.monthlyHint")}</Hint>

        <Link href={`/roadmap?id=${selected.id}`} className={buttonClass("nav")}>
          ← {t("roadmap.backToYears")}
        </Link>
      </div>
    );
  }

  // With nothing from the ledger, 실적 is 계획 copied out a second time
  // — two columns of the same numbers, on the screen least able to
  // spare the width.
  const hasActuals = actualByYear.size > 0;

  return (
    <div className="space-y-4">
      {header}

      {versions.length > 1 && (
        <Card>
          <div role="group" data-testid="roadmap-versions" className="flex flex-wrap gap-1 p-1">
            {versions.map((version) => (
              <Link
                key={version.id}
                href={`/roadmap?id=${version.id}`}
                aria-current={version.id === selected.id ? "page" : undefined}
                className={buttonClass(version.id === selected.id ? "primary" : "ghost")}
              >
                {version.name}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
          <span className="font-semibold">{selected.name}</span>
          <span className="text-ink-faint tnum text-sm">
            {selected.startYear}–{selected.endYear}
          </span>
          <Link
            href={`/roadmap?id=${selected.id}&edit=1`}
            className={`${buttonClass("nav")} -my-2 ml-auto`}
          >
            {t("roadmap.editVersion")}
          </Link>
        </div>
        <div className="border-rule-soft text-ink-faint flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-3 text-sm">
          <span>
            {t("roadmap.startingAmount")}{" "}
            <span className="tnum text-ink-muted">{money(selected.startingAmount)}</span>
          </span>
          {/* 「기본」, not 「연저축액」: most years now work their own out
              from the months, and this is only what a year with nothing
              to go on falls back to. */}
          <span>
            {t("roadmap.defaultContribution")}{" "}
            <span className="tnum text-ink-muted">{money(selected.defaultContribution)}</span>
          </span>
          <span>
            {t("roadmap.defaultReturnRate")}{" "}
            <span className="tnum text-ink-muted">{asPercent(selected.defaultReturnRate)}%</span>
          </span>
        </div>
      </Card>

      {!selected.actualFormulaId && <Hint>{t("roadmap.pickFormulaHint")}</Hint>}

      {/* Formatted here rather than in the browser: the money strings
          have to be the section's own currency in the reader's locale,
          and that knowledge already lives on this side. */}
      <RoadmapImage
        name={selected.name}
        period={`${selected.startYear}–${selected.endYear}`}
        summary={[
          { label: t("roadmap.startingAmount"), value: money(selected.startingAmount) },
          { label: t("roadmap.defaultContribution"), value: money(selected.defaultContribution) },
          {
            label: t("roadmap.defaultReturnRate"),
            value: `${asPercent(selected.defaultReturnRate)}%`,
          },
        ]}
        rows={rows.map((row) => ({
          year: row.year,
          plan: money(row.planEnd),
          live: money(row.liveEnd),
          actualRate: row.actualReturnRate === null ? null : `${asPercent(row.actualReturnRate)}%`,
          targetRate: `${asPercent(row.returnRate)}%`,
          fromLedger: row.actual !== null,
        }))}
        labels={{
          save: t("roadmap.saveImage"),
          saving: t("roadmap.savingImage"),
          mask: t("roadmap.maskAmounts"),
          title: t("roadmap.title"),
          year: t("roadmap.year"),
          plan: t("roadmap.planEnd"),
          live: t("roadmap.liveEnd"),
          actualRate: t("roadmap.imageActual"),
          targetRate: t("roadmap.imageTarget"),
          // The note names both columns, and one of them is only drawn
          // when the ledger has something to say.
          rateNote: rows.some((row) => row.actualReturnRate !== null)
            ? t("roadmap.imageRateNote")
            : t("roadmap.imageTargetNote"),
        }}
      />

      {/* A real table, scrolled inside its own box. Seven columns will
          not fit a phone, and the alternative — a card per year — loses
          the one thing a roadmap is read for, which is comparing a
          column down the years. The page itself stays unscrolled.

          On a phone, 「가로로 보기」 lays the whole block on its side so
          the table gets the screen's long side. */}
      <TurnToRead
        labels={{
          turn: t("roadmap.turn"),
          unturn: t("roadmap.unturn"),
          hint: t("roadmap.rotateHint"),
        }}
      >
        <Card className="h-full">
          {/* Inside the card for the same reason as the month table —
              and h-full on both so the quarter-turned view can give the
              scroller the whole box. */}
          <div className="h-full overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-rule-soft text-ink-faint border-b text-left">
                  <th scope="col" className={`${cell} bg-card sticky left-0 z-10 font-medium`}>
                    {t("roadmap.year")}
                  </th>
                  {/* The closing figures come first, right beside the year.
                  They are what the table is read for, and at 393px only
                  the first money column is on screen without scrolling
                  — so it had better be this one and not an input. */}
                  <th scope="col" className={`${cell} text-right font-medium`}>
                    {t("roadmap.planEnd")}
                  </th>
                  {hasActuals && (
                    <th scope="col" className={`${cell} text-right font-medium`}>
                      {t("roadmap.liveEnd")}
                    </th>
                  )}
                  {/* Next to 실적 기말, because it is the number that
                    explains the gap between the two closing figures
                    beside it — and because on a phone that puts it two
                    columns from the year rather than at the far end. */}
                  {hasActuals && (
                    <th scope="col" className={`${cell} text-right font-medium`}>
                      {t("roadmap.actualReturnRate")}
                    </th>
                  )}
                  <th scope="col" className={`${cell} text-right font-medium`}>
                    {t("roadmap.returnRate")}
                  </th>
                  <th scope="col" className={`${cell} text-right font-medium`}>
                    {t("roadmap.contribution")}
                  </th>
                  <th scope="col" className={`${cell} font-medium`}>
                    {t("roadmap.note")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.year}
                    data-testid="roadmap-row"
                    className="border-rule-soft border-t"
                  >
                    <td className="bg-card sticky left-0 z-10 p-0">
                      <RowDialog
                        title={`${row.year}`}
                        closeLabel={t("common.close")}
                        trigger={
                          <span className="tnum flex items-center gap-1.5 font-semibold">
                            {row.year}
                            {row.overridden && <span className="text-accent text-xs">●</span>}
                          </span>
                        }
                      >
                        <YearForm
                          roadmapId={selected.id}
                          row={row}
                          currency={section.baseCurrency}
                          labels={{
                            contribution: t("roadmap.contribution"),
                            returnRate: t("roadmap.returnRate"),
                            note: t("roadmap.note"),
                            save: t("common.save"),
                            saving: t("common.saving"),
                            hint: t("roadmap.overrideHint"),
                          }}
                        />
                      </RowDialog>
                    </td>
                    <td className={`${num} ${hasActuals ? "text-ink-muted" : "font-semibold"}`}>
                      {money(row.planEnd)}
                    </td>
                    {hasActuals && (
                      <td className={`${num} font-semibold`}>
                        {money(row.liveEnd)}
                        {row.actual !== null && (
                          <span
                            className="text-positive ml-1 text-xs"
                            title={t("roadmap.fromLedger")}
                          >
                            ✓
                          </span>
                        )}
                      </td>
                    )}
                    {hasActuals && (
                      <td className={num} data-testid="roadmap-rate">
                        {row.actualReturnRate === null ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          // Coloured only when it fell short of the target,
                          // because a year that beat it needs no marking
                          // beyond the number itself.
                          <span
                            className={`font-semibold ${
                              row.actualReturnRate < row.returnRate ? "text-negative" : ""
                            }`}
                          >
                            {asPercent(row.actualReturnRate)}%
                          </span>
                        )}
                      </td>
                    )}
                    <td className={`${num} text-ink-muted`} data-testid="roadmap-target-rate">
                      {asPercent(row.returnRate)}%
                    </td>
                    {/* Straight through to the twelve months it came
                      from, where a year that looks wrong can be read one
                      month at a time and the gaps filled in. Faint when
                      the roadmap's flat default was all there was —
                      nothing stands behind that figure but a guess. */}
                    <td className="p-0">
                      <Link
                        href={`/roadmap?id=${selected.id}&year=${row.year}`}
                        className={`hover:bg-sunken tnum flex min-h-12 items-center justify-end px-3 whitespace-nowrap ${
                          row.contributionSource === "default" ? "text-ink-faint" : ""
                        }`}
                      >
                        {money(row.contribution)}
                      </Link>
                    </td>
                    <td className={`${cell} max-w-40 truncate`}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </TurnToRead>

      <Hint>{t("roadmap.tableHint")}</Hint>
      <Hint>{t("roadmap.contributionHint")}</Hint>
      <Hint>{t("roadmap.rateHint")}</Hint>
    </div>
  );
}

/** The per-year override form, inside the year's dialog. */
function YearForm({
  roadmapId,
  row,
  currency,
  labels,
}: {
  roadmapId: string;
  row: RoadmapRow;
  currency: string;
  labels: Record<"contribution" | "returnRate" | "note" | "save" | "saving" | "hint", string>;
}) {
  // Placeholders rather than values: a box showing the default it
  // inherited cannot be told from one holding an override, and saving
  // would then turn every inherited figure into a stored one.
  const stored = row.overridden;

  return (
    <DialogActionForm action={setRoadmapYearAction} className="space-y-3">
      <input type="hidden" name="roadmapId" value={roadmapId} />
      <input type="hidden" name="year" value={row.year} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`c-${row.year}`}>{labels.contribution}</Label>
          <input
            id={`c-${row.year}`}
            type="number"
            name="contribution"
            step="any"
            inputMode="decimal"
            defaultValue={stored ? String(toMajorUnits(row.contribution, currency)) : ""}
            placeholder={String(toMajorUnits(row.contribution, currency))}
            className={`${controlClass} tnum`}
          />
        </div>
        <div>
          <Label htmlFor={`r-${row.year}`}>{labels.returnRate}</Label>
          <input
            id={`r-${row.year}`}
            type="number"
            name="returnRate"
            step="any"
            inputMode="decimal"
            defaultValue={stored ? String(asPercent(row.returnRate)) : ""}
            placeholder={String(asPercent(row.returnRate))}
            className={`${controlClass} tnum`}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`n-${row.year}`}>{labels.note}</Label>
        <input
          id={`n-${row.year}`}
          type="text"
          name="note"
          defaultValue={row.note ?? ""}
          className={controlClass}
        />
      </div>

      <SubmitButton variant="primary" pendingLabel={labels.saving} full>
        {labels.save}
      </SubmitButton>
      <Hint>{labels.hint}</Hint>
    </DialogActionForm>
  );
}
