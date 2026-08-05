import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-client";
import { accounts, authUsers } from "@/db/schema";
import type { Db } from "@/db/types";
import { getOrCreateSection } from "./current-section";

describe("getOrCreateSection", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(authUsers).values({ id: "u1", email: "me@example.com" });
  });

  it("creates a section with defaults and seeds its chart of accounts", async () => {
    const section = await getOrCreateSection(db, { userId: "u1", locale: "ko" });

    expect(section.userId).toBe("u1");
    expect(section.baseCurrency).toBe("KRW");
    expect(section.timezone).toBe("Asia/Seoul");
    expect(section.name).toBe("기본");
    expect(section.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const seeded = await db.select().from(accounts).where(eq(accounts.sectionId, section.id));
    expect(seeded.length).toBeGreaterThan(0);
  });

  it("is idempotent: a second call returns the same section, no duplicate", async () => {
    const first = await getOrCreateSection(db, { userId: "u1", locale: "ko" });
    const second = await getOrCreateSection(db, { userId: "u1", locale: "ko" });

    expect(second.id).toBe(first.id);

    const seeded = await db.select().from(accounts).where(eq(accounts.sectionId, first.id));
    expect(seeded).toHaveLength(10); // seeded once, not twice
  });

  it("uses the English default chart when the locale is en", async () => {
    const section = await getOrCreateSection(db, { userId: "u1", locale: "en" });
    expect(section.name).toBe("Default");

    const seeded = await db.select().from(accounts).where(eq(accounts.sectionId, section.id));
    expect(seeded.map((a) => a.name)).toContain("Food");
  });
});
