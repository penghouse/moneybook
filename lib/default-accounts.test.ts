import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-client";
import { accounts, authUsers, sections } from "@/db/schema";
import type { Db } from "@/db/types";
import { seedDefaultAccounts } from "./default-accounts";

async function seedSection(db: Db, sectionId: string, baseCurrency: string) {
  await db.insert(authUsers).values({ id: "u1", email: "me@example.com" });
  await db.insert(sections).values({
    id: sectionId,
    userId: "u1",
    name: "기본",
    baseCurrency,
    timezone: "Asia/Seoul",
    startDate: "2026-01-01",
  });
}

describe("seedDefaultAccounts", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("seeds a full 5-group Korean chart of accounts", async () => {
    await seedSection(db, "s1", "KRW");
    await seedDefaultAccounts(db, {
      sectionId: "s1",
      locale: "ko",
      baseCurrency: "KRW",
    });

    const rows = await db.select().from(accounts).where(eq(accounts.sectionId, "s1"));
    expect(rows).toHaveLength(10);

    const groupCounts = Object.groupBy(rows, (r) => r.group);
    expect(groupCounts.asset).toHaveLength(2);
    expect(groupCounts.liability).toHaveLength(1);
    expect(groupCounts.equity).toHaveLength(1);
    expect(groupCounts.expense).toHaveLength(4);
    expect(groupCounts.income).toHaveLength(2);

    expect(rows.every((r) => r.currency === "KRW")).toBe(true);
    expect(rows.map((r) => r.name)).toContain("식비");
  });

  it("seeds English names and follows the section's base currency", async () => {
    await seedSection(db, "s2", "USD");
    await seedDefaultAccounts(db, {
      sectionId: "s2",
      locale: "en",
      baseCurrency: "USD",
    });

    const rows = await db.select().from(accounts).where(eq(accounts.sectionId, "s2"));
    expect(rows.map((r) => r.name)).toContain("Food");
    expect(rows.every((r) => r.currency === "USD")).toBe(true);
  });

  it("has no duplicate names within a locale (the schema enforces uniqueness per section)", async () => {
    await seedSection(db, "s3", "KRW");
    await expect(
      seedDefaultAccounts(db, { sectionId: "s3", locale: "ko", baseCurrency: "KRW" }),
    ).resolves.not.toThrow();
  });
});
