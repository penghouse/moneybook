"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { formulas, FORMULA_SCOPES, type FormulaScope } from "@/db/schema";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { parseTermKey, serializeTerms, type FormulaTerm } from "@/lib/formulas";

/** Field-name prefix for the per-item +/−/none radios. */
const TERM_PREFIX = "t:";

function scopeOf(value: FormDataEntryValue | null): FormulaScope {
  return FORMULA_SCOPES.includes(value as FormulaScope) ? (value as FormulaScope) : "assets";
}

/** Where the reader goes back to once the list has changed. */
const listHref = (scope: FormulaScope) => `/formulas?scope=${scope}`;

export async function saveFormulaAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const scope = scopeOf(formData.get("scope"));
  const id = formData.get("id");
  const name = String(formData.get("name") ?? "").trim();
  const expression = String(formData.get("expression") ?? "").trim();

  // A nameless formula is a row nobody can identify, and the input is
  // `required`, so arriving here without one means the form was
  // bypassed rather than mistyped.
  if (!name) redirect(`${listHref(scope)}&error=name${id ? `&id=${id}` : ""}`);

  // The expression is *not* gated. A typo would otherwise throw away
  // every term the reader had just picked, to protect them from a
  // mistake the report can simply show them: an unreadable expression
  // says so where its number would be, on the report and in this list,
  // and is one tap from being fixed.

  const terms: FormulaTerm[] = [];
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith(TERM_PREFIX)) continue;
    const sign = value === "+" ? 1 : value === "-" ? -1 : null;
    if (sign === null) continue;
    // The key came from a form field, so it names whatever the browser
    // was handed — parsed rather than trusted, same as on read.
    const ref = parseTermKey(field.slice(TERM_PREFIX.length));
    if (ref) terms.push({ ...ref, sign });
  }

  const values = { name, expression, terms: serializeTerms(terms) };

  if (typeof id === "string" && id) {
    // Scoped by section: the id arrives from a form field, so it is the
    // caller's claim about which formula this is, not a fact.
    await db
      .update(formulas)
      .set(values)
      .where(and(eq(formulas.id, id), eq(formulas.sectionId, section.id)));
  } else {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${formulas.sortOrder}), 0) + 10` })
      .from(formulas)
      .where(and(eq(formulas.sectionId, section.id), eq(formulas.scope, scope)));
    await db.insert(formulas).values({ sectionId: section.id, scope, sortOrder: next, ...values });
  }

  revalidatePath("/formulas");
  revalidatePath(scope === "assets" ? "/assets" : "/income");
  redirect(listHref(scope));
}

export async function deleteFormulaAction(formData: FormData) {
  const userId = await requireUserId();
  const { locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });

  const scope = scopeOf(formData.get("scope"));
  const id = formData.get("id");
  if (typeof id === "string" && id) {
    await db.delete(formulas).where(and(eq(formulas.id, id), eq(formulas.sectionId, section.id)));
  }

  revalidatePath("/formulas");
  revalidatePath(scope === "assets" ? "/assets" : "/income");
  redirect(listHref(scope));
}
