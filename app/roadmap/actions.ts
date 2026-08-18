"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { formulas, roadmaps, roadmapYears } from "@/db/schema";
import { currentSection } from "@/lib/current-request";
import { toMinorUnits } from "@/lib/money";
import { MAX_ROADMAP_YEARS } from "@/lib/roadmap";

/** A blank field means "leave it out", not "zero". */
function optionalMinor(value: FormDataEntryValue | null, currency: string): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const major = Number(raw);
  return Number.isFinite(major) ? toMinorUnits(major, currency) : null;
}

/**
 * Percent in the box, multiplier in the table. 10 is what a person
 * writes; 0.1 is what compounds.
 */
function optionalRate(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const percent = Number(raw);
  return Number.isFinite(percent) ? percent / 100 : null;
}

function requiredMinor(value: FormDataEntryValue | null, currency: string): number {
  return optionalMinor(value, currency) ?? 0;
}

const listHref = (id?: string) => (id ? `/roadmap?id=${id}` : "/roadmap");

export async function saveRoadmapAction(formData: FormData) {
  const { section } = await currentSection();

  const id = formData.get("id");
  const editing = typeof id === "string" && id ? id : null;
  const back = editing ? `/roadmap?id=${editing}&edit=1` : "/roadmap?new=1";

  const name = String(formData.get("name") ?? "").trim();
  const startYear = String(formData.get("startYear") ?? "").trim();
  const endYear = String(formData.get("endYear") ?? "").trim();

  if (!name) redirect(`${back}&error=name`);
  // Checked here as well as by the CHECK constraint: a constraint
  // violation surfaces as a 500, and this is a typo, not an attack.
  if (!/^\d{4}$/.test(startYear) || !/^\d{4}$/.test(endYear)) redirect(`${back}&error=year`);
  if (Number(endYear) < Number(startYear)) redirect(`${back}&error=range`);
  if (Number(endYear) - Number(startYear) + 1 > MAX_ROADMAP_YEARS) redirect(`${back}&error=span`);

  // The formula is the roadmap's only link outside itself, and the id
  // arrives in a form body — so it is checked against this section's
  // formulas rather than taken at its word. An unknown id becomes null,
  // which is the same state as "no formula chosen".
  const formulaId = String(formData.get("actualFormulaId") ?? "").trim();
  let actualFormulaId: string | null = null;
  if (formulaId) {
    const owned = await db.query.formulas.findFirst({
      where: and(
        eq(formulas.id, formulaId),
        eq(formulas.sectionId, section.id),
        eq(formulas.scope, "assets"),
      ),
      columns: { id: true },
    });
    actualFormulaId = owned?.id ?? null;
  }

  const values = {
    name,
    startYear,
    endYear,
    startingAmount: requiredMinor(formData.get("startingAmount"), section.baseCurrency),
    defaultContribution: requiredMinor(formData.get("defaultContribution"), section.baseCurrency),
    defaultReturnRate: optionalRate(formData.get("defaultReturnRate")) ?? 0,
    actualFormulaId,
  };

  if (editing) {
    await db
      .update(roadmaps)
      .set(values)
      .where(and(eq(roadmaps.id, editing), eq(roadmaps.sectionId, section.id)));
    revalidatePath("/roadmap");
    redirect(listHref(editing));
  }

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${roadmaps.sortOrder}), 0) + 10` })
    .from(roadmaps)
    .where(eq(roadmaps.sectionId, section.id));
  const [created] = await db
    .insert(roadmaps)
    .values({ sectionId: section.id, sortOrder: next, ...values })
    .returning({ id: roadmaps.id });

  revalidatePath("/roadmap");
  redirect(listHref(created.id));
}

export async function deleteRoadmapAction(formData: FormData) {
  const { section } = await currentSection();

  const id = formData.get("id");
  if (typeof id === "string" && id) {
    // roadmap_years cascades on roadmaps.id.
    await db.delete(roadmaps).where(and(eq(roadmaps.id, id), eq(roadmaps.sectionId, section.id)));
  }

  revalidatePath("/roadmap");
  redirect("/roadmap");
}

/**
 * One year's departure from the roadmap's defaults.
 *
 * Emptying every field deletes the row rather than storing three nulls:
 * a row of nothing-in-particular would keep the year marked as edited
 * and would go on shadowing a later change to the defaults.
 */
export async function setRoadmapYearAction(formData: FormData) {
  const { section } = await currentSection();

  const roadmapId = String(formData.get("roadmapId") ?? "");
  const year = String(formData.get("year") ?? "").trim();
  if (!/^\d{4}$/.test(year)) redirect("/roadmap");

  // The roadmap id comes from the form, so ownership is established
  // before anything is written against it.
  const owner = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, roadmapId), eq(roadmaps.sectionId, section.id)),
    columns: { id: true },
  });
  if (!owner) redirect("/roadmap");

  const contribution = optionalMinor(formData.get("contribution"), section.baseCurrency);
  const returnRate = optionalRate(formData.get("returnRate"));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (contribution === null && returnRate === null && note === null) {
    await db
      .delete(roadmapYears)
      .where(and(eq(roadmapYears.roadmapId, owner.id), eq(roadmapYears.year, year)));
  } else {
    await db
      .insert(roadmapYears)
      .values({ roadmapId: owner.id, year, contribution, returnRate, note })
      .onConflictDoUpdate({
        target: [roadmapYears.roadmapId, roadmapYears.year],
        set: { contribution, returnRate, note },
      });
  }

  revalidatePath("/roadmap");
}
