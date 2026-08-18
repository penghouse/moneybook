import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { accounts, formulas, FORMULA_SCOPES, type FormulaScope } from "@/db/schema";
import { activeOn } from "@/lib/accounts";
import { parseGroupOrder } from "@/lib/account-groups";
import { currentSection } from "@/lib/current-request";
import { monthRange, today, yearMonthOf } from "@/lib/date";
import { buildFormulaItems, formulaValues } from "@/lib/formula-items";
import { evaluateFormula, parseTerms, termKey } from "@/lib/formulas";
import { getAccountBalances, getAccountFlows } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { formulaTotalLabels } from "../_components/formula-section";
import { SubmitButton } from "../_components/submit-button";
import {
  buttonClass,
  Card,
  controlClass,
  EmptyState,
  Hint,
  KeyValueRow,
  Label,
  PageHeader,
  SectionLabel,
} from "../_components/ui";
import { deleteFormulaAction, saveFormulaAction } from "./actions";

/** The radio value that stands for a term's sign. */
const signValue = (sign: 1 | -1) => (sign === 1 ? "+" : "-");

export default async function FormulasPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string; new?: string; error?: string }>;
}) {
  const { section, t, locale } = await currentSection();
  const params = await searchParams;

  const scope: FormulaScope = FORMULA_SCOPES.includes(params.scope as FormulaScope)
    ? (params.scope as FormulaScope)
    : "assets";
  const reportHref = scope === "assets" ? "/assets" : "/income";

  /**
   * The figures the menu shows next to each item.
   *
   * As of *now* — today's balances, this month's flows — whichever
   * period the report the reader came from happened to be on. A formula
   * is a recipe, and picking terms against August's numbers while the
   * screen says March would make it look like the formula was about
   * March. The report itself evaluates against whatever it is showing.
   */
  const now = today(section.timezone);
  const month = monthRange(yearMonthOf(now));
  // Four reads that need nothing from each other. The two catalogs are
  // separate queries rather than one filtered in JS because `activeOn`
  // is the database's own predicate — see lib/accounts — and running the
  // active-window rule twice, once here and once there, is how the two
  // drift apart.
  const [figures, catalog, liveCatalog, rows] = await Promise.all([
    scope === "assets"
      ? getAccountBalances(db, { sectionId: section.id, asOf: now })
      : getAccountFlows(db, { sectionId: section.id, from: month.from, to: month.to }),
    db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    }),
    db.query.accounts.findMany({
      where: and(eq(accounts.sectionId, section.id), activeOn(now)),
      orderBy: asc(accounts.sortOrder),
      columns: { id: true, name: true, group: true, category: true },
    }),
    db.query.formulas.findMany({
      where: and(eq(formulas.sectionId, section.id), eq(formulas.scope, scope)),
      orderBy: asc(formulas.sortOrder),
    }),
  ]);
  const amountByAccountId = new Map(figures.map((f) => [f.accountId, f.baseAmount]));

  const groupOrder = parseGroupOrder(section.groupOrder);
  const totals = formulaTotalLabels(scope, t);

  /**
   * Two menus, not one.
   *
   * `items` is built from the whole catalog because it is what the
   * formulas are *evaluated* against, and a formula that names an
   * account closed last year must still add it up — dropping it from the
   * sum would quietly change a number nobody touched.
   *
   * `pickable` is what the editor offers, and that is only what is in
   * use today. Writing a new formula out of accounts that have been
   * retired is not something anyone means to do, and the list is long
   * enough without them.
   */
  const items = buildFormulaItems({
    scope,
    groupOrder,
    accounts: catalog,
    amountByAccountId,
    labels: { totals },
  });
  const values = { byKey: formulaValues(items) };

  const pickable = buildFormulaItems({
    scope,
    groupOrder,
    accounts: liveCatalog,
    amountByAccountId,
    labels: { totals },
  });

  const editing = params.id ? rows.find((r) => r.id === params.id) : undefined;
  const isNew = params.new === "1" && !editing;
  const base = (minor: number) => formatMoney(minor, section.baseCurrency, locale);

  const scopes: { scope: FormulaScope; label: string }[] = [
    { scope: "assets", label: t("nav.assets") },
    { scope: "income", label: t("nav.income") },
  ];

  if (editing || isNew) {
    const selected = new Map(
      parseTerms(editing?.terms ?? "[]").map((term) => [termKey(term), term.sign] as const),
    );

    return (
      <div className="space-y-4">
        <PageHeader title={editing ? t("formula.edit") : t("formula.add")} />

        <form action={saveFormulaAction} className="space-y-4">
          <input type="hidden" name="scope" value={scope} />
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <Card>
            <div className="space-y-3 px-4 py-4">
              <div>
                <Label htmlFor="formula-name">{t("formula.name")}</Label>
                <input
                  id="formula-name"
                  type="text"
                  name="name"
                  required
                  defaultValue={editing?.name ?? ""}
                  placeholder={t("formula.namePlaceholder")}
                  className={controlClass}
                />
              </div>
              {params.error === "name" && (
                <p className="text-negative text-sm">{t("formula.nameRequired")}</p>
              )}
            </div>
          </Card>

          <section>
            <SectionLabel>{t("formula.terms")}</SectionLabel>
            <Card>
              {pickable.map((item) => {
                const sign = selected.get(item.key);
                return (
                  <div
                    key={item.key}
                    data-testid="formula-item"
                    className={`not-first:border-rule-soft flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 not-first:border-t ${
                      item.level === "account" ? "border-rule-soft mx-4 border-l pl-3" : "px-4"
                    }`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        item.level === "total"
                          ? "font-bold"
                          : item.level === "category"
                            ? "font-semibold"
                            : ""
                      }`}
                    >
                      {item.label}
                    </span>
                    {/* Three states in one control, because an item is
                        added, subtracted, or not in the formula — and the
                        two-column checkbox version of this lets you tick
                        both sides of the same row. */}
                    <div className="border-rule flex shrink-0 overflow-hidden rounded-full border">
                      {(
                        [
                          [
                            "",
                            t("formula.none"),
                            "—",
                            "has-checked:bg-sunken has-checked:text-ink",
                          ],
                          [
                            "+",
                            t("formula.plus"),
                            "+",
                            "has-checked:bg-positive has-checked:text-accent-ink",
                          ],
                          [
                            "-",
                            t("formula.minus"),
                            "−",
                            "has-checked:bg-negative has-checked:text-accent-ink",
                          ],
                        ] as const
                      ).map(([value, label, glyph, checkedClass]) => {
                        // Which of the three is checked, worked out from
                        // the sign rather than per-cell: written the
                        // other way round, an item with no sign made
                        // *both* 없음 and 빼기 checked, the DOM kept the
                        // last one, and every item nobody had touched
                        // went into the formula as a subtraction.
                        const active =
                          sign === undefined ? value === "" : signValue(sign) === value;
                        return (
                          <label
                            key={value || "none"}
                            // Coloured by the *live* :checked state, not by
                            // what was saved. Rendered from the saved sign,
                            // the cell simply never lit up when you pressed
                            // it — the radio changed, the page did not, and
                            // the control read as broken. No script: the
                            // browser already knows which radio is on.
                            className={`tnum text-ink-faint relative flex h-11 w-11 items-center justify-center text-sm has-checked:font-bold ${checkedClass}`}
                          >
                            {/* The radio *is* the cell rather than a
                                visually-hidden dot beside it: the whole
                                44px square is then its own hit area, and
                                the glyph cannot sit between a finger and
                                the control it is labelling. */}
                            <input
                              type="radio"
                              name={`t:${item.key}`}
                              value={value}
                              defaultChecked={active}
                              aria-label={`${item.label} ${label}`}
                              className="focus-visible:outline-accent absolute inset-0 h-full w-full cursor-pointer appearance-none focus-visible:outline-2 focus-visible:-outline-offset-2"
                            />
                            <span aria-hidden="true" className="pointer-events-none">
                              {glyph}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Card>
            <Hint>{t("formula.termsHint")}</Hint>
          </section>

          <section>
            <SectionLabel>{t("formula.expression")}</SectionLabel>
            <Card>
              <div className="space-y-2 px-4 py-4">
                <input
                  type="text"
                  name="expression"
                  inputMode="text"
                  defaultValue={editing?.expression ?? ""}
                  placeholder={t("formula.expressionPlaceholder")}
                  className={`${controlClass} tnum`}
                />
                {params.error === "expression" && (
                  <p className="text-negative text-sm">{t("formula.expressionInvalid")}</p>
                )}
              </div>
            </Card>
            <Hint>{t("formula.expressionHint")}</Hint>
          </section>

          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="primary" pendingLabel={t("common.saving")}>
              {t("common.save")}
            </SubmitButton>
            <Link href={`/formulas?scope=${scope}`} className={buttonClass("ghost")}>
              {t("common.cancel")}
            </Link>
          </div>
        </form>

        {editing && (
          // Its own form, outside the one above: a 삭제 button inside the
          // editing form would submit the edits it is discarding.
          <form action={deleteFormulaAction}>
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="id" value={editing.id} />
            <SubmitButton variant="danger" pendingLabel={t("common.working")}>
              {t("common.delete")}
            </SubmitButton>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("formula.manage")}>
        <Link href={`/formulas?scope=${scope}&new=1`} className={buttonClass("primary")}>
          {t("formula.add")}
        </Link>
      </PageHeader>

      <Card>
        <div role="group" data-testid="formula-scope" className="flex gap-1 px-1 py-1">
          {scopes.map((option) => (
            <Link
              key={option.scope}
              href={`/formulas?scope=${option.scope}`}
              aria-current={option.scope === scope ? "page" : undefined}
              className={`${buttonClass(option.scope === scope ? "primary" : "ghost")} flex-1 justify-center`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState>{t("formula.empty")}</EmptyState>
        ) : (
          rows.map((row) => {
            const outcome = evaluateFormula(
              { terms: parseTerms(row.terms), expression: row.expression },
              values,
              section.baseCurrency,
            );
            return (
              <KeyValueRow
                key={row.id}
                href={`/formulas?scope=${scope}&id=${row.id}`}
                label={row.name}
                value={
                  outcome.ok ? (
                    <span className="tnum font-semibold">{base(outcome.amount)}</span>
                  ) : (
                    // The same message the report shows, so a formula
                    // that cannot be worked out is diagnosed in the one
                    // place it can be edited.
                    <span className="text-negative text-sm">
                      {outcome.error.kind === "notFinite"
                        ? t("formula.expressionBroken")
                        : t("formula.expressionInvalid")}
                    </span>
                  )
                }
              />
            );
          })
        )}
      </Card>
      <Hint>{t("formula.snapshotHint")}</Hint>

      <Link href={reportHref} className={buttonClass("nav")}>
        ← {t("assets.backToList")}
      </Link>
    </div>
  );
}
