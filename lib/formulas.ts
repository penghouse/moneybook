import { ACCOUNT_GROUPS, type AccountGroup, type FormulaScope } from "@/db/schema";
import { evaluateExpression, type ExpressionError } from "./expression";
import { toMajorUnits, toMinorUnits } from "./money";

/**
 * What a 계산식 is made of, and how it is read back from the database.
 *
 * A term names something the report already shows — one account, one
 * 상위 그룹, or one of the report's own totals — and says whether to add
 * or subtract it. Their signed sum is `x`, which the formula's
 * expression then does arithmetic on.
 *
 * Everything here is written to survive the book changing underneath it.
 * An account gets deleted, a 상위 그룹 gets renamed, a term is stored by
 * a version that knew a kind this one does not: in every case the term
 * drops out and the rest of the formula still reports a number, with the
 * screen saying how many went missing. The alternative — a report that
 * throws because of a row nobody has looked at in a year — is worse.
 */

/** The report-level figures a formula can name, per scope. */
export const FORMULA_TOTALS = {
  assets: ["assets", "liabilities", "netWorth"],
  income: ["income", "expense", "netIncome"],
} as const satisfies Record<FormulaScope, readonly string[]>;

export type FormulaTotal = (typeof FORMULA_TOTALS)[FormulaScope][number];

const ALL_TOTALS: readonly string[] = [...FORMULA_TOTALS.assets, ...FORMULA_TOTALS.income];

/** What a term points at, without saying whether it is added or subtracted. */
export type FormulaRef =
  | { kind: "account"; accountId: string }
  | { kind: "category"; group: AccountGroup; name: string }
  | { kind: "total"; total: FormulaTotal };

export type FormulaTerm = FormulaRef & { sign: 1 | -1 };

/** A term's identity as one string, for form fields and for de-duping. */
export function termKey(term: FormulaRef): string {
  switch (term.kind) {
    case "account":
      return `account:${term.accountId}`;
    case "category":
      return `category:${term.group}:${term.name}`;
    case "total":
      return `total:${term.total}`;
  }
}

/**
 * Rebuild a term from the key a form field carried.
 *
 * Split with a limit rather than on every colon: a 상위 그룹 is free
 * text and 「생활비:고정」 is a name someone will type.
 */
export function parseTermKey(key: string): FormulaRef | null {
  const firstColon = key.indexOf(":");
  if (firstColon < 0) return null;
  const kind = key.slice(0, firstColon);
  const rest = key.slice(firstColon + 1);

  if (kind === "account") return rest ? { kind: "account", accountId: rest } : null;
  if (kind === "total") {
    return ALL_TOTALS.includes(rest) ? { kind: "total", total: rest as FormulaTotal } : null;
  }
  if (kind === "category") {
    const secondColon = rest.indexOf(":");
    if (secondColon < 0) return null;
    const group = rest.slice(0, secondColon);
    const name = rest.slice(secondColon + 1);
    if (!ACCOUNT_GROUPS.includes(group as AccountGroup) || !name) return null;
    return { kind: "category", group: group as AccountGroup, name };
  }
  return null;
}

/** Terms as stored. Round-trips through `parseTerms`. */
export function serializeTerms(terms: readonly FormulaTerm[]): string {
  return JSON.stringify(terms);
}

/**
 * Terms as read — never trusted, since this column outlives the code
 * that wrote it.
 */
export function parseTerms(stored: string | null | undefined): FormulaTerm[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stored || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const terms: FormulaTerm[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const sign = record.sign === -1 ? -1 : record.sign === 1 ? 1 : null;
    if (sign === null) continue;

    let term: FormulaRef | null = null;
    if (record.kind === "account" && typeof record.accountId === "string" && record.accountId) {
      term = { kind: "account", accountId: record.accountId };
    } else if (
      record.kind === "category" &&
      typeof record.name === "string" &&
      record.name &&
      ACCOUNT_GROUPS.includes(record.group as AccountGroup)
    ) {
      term = { kind: "category", group: record.group as AccountGroup, name: record.name };
    } else if (record.kind === "total" && ALL_TOTALS.includes(record.total as string)) {
      term = { kind: "total", total: record.total as FormulaTotal };
    }
    if (!term) continue;

    // One item cannot be both added and subtracted, and listing it twice
    // on the same side would double it — the editor offers one choice
    // per row, so a duplicate means the data is confused, not clever.
    const key = termKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push({ ...term, sign });
  }
  return terms;
}

export interface FormulaValues {
  /** Minor units, in the section's base currency, keyed by `termKey`. */
  byKey: ReadonlyMap<string, number>;
}

export type FormulaOutcome =
  | { ok: true; amount: number; missing: number }
  | { ok: false; error: ExpressionError; missing: number };

/**
 * Work a formula out against what a report is currently showing.
 *
 * The arithmetic happens in *major* units — the amounts on screen — so
 * "x-310000000" means 3.1억 rather than 3.1억 cents, and the reader is
 * typing the numbers they can see. Only the ends convert.
 */
export function evaluateFormula(
  formula: { terms: readonly FormulaTerm[]; expression: string },
  values: FormulaValues,
  currency: string,
): FormulaOutcome {
  let sumMinor = 0;
  let missing = 0;
  for (const term of formula.terms) {
    const amount = values.byKey.get(termKey(term));
    if (amount === undefined) {
      missing += 1;
      continue;
    }
    sumMinor += term.sign * amount;
  }

  const result = evaluateExpression(formula.expression, toMajorUnits(sumMinor, currency));
  if (!result.ok) return { ok: false, error: result.error, missing };
  return { ok: true, amount: Math.round(toMinorUnits(result.value, currency)), missing };
}
