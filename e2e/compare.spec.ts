import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("compare", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`compare-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
    ]);
  });

  async function seed(userId: string) {
    const section = await getOrCreateSection(db, { userId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const food = await byName("식비");
    const transport = await byName("교통비");
    const card = await byName("신용카드");
    const bank = await byName("은행");
    const opening = await byName("기초자본");

    const post = async (date: string, left: string, right: string, amount: number) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title: "거래" })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: left,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
          lineOrder: 0,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: right,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
          lineOrder: 1,
        },
      ]);
    };

    // 식비: 100,000 last September, 120,000 this September.
    await post("2025-09-10", food.id, card.id, 100_000);
    await post("2026-09-10", food.id, card.id, 120_000);
    // 교통비: only in August, so September's comparison against the month
    // just before it has to show it disappearing.
    await post("2026-08-10", transport.id, card.id, 50_000);
    // And a balance that grew between the two Septembers.
    await post("2025-09-01", bank.id, opening.id, 1_000_000);
    await post("2026-09-01", bank.id, opening.id, 500_000);
    return section;
  }

  test("holds a period against the one just before it, and against a year ago", async ({
    page,
  }) => {
    await seed(currentUserId);
    await page.goto("/compare?from=2026-09-01&to=2026-09-30&scope=flow&against=previous");

    // 직전기간 is the window before, however long it is.
    await expect(page.getByText("2026-08-01 ~ 2026-08-31")).toBeVisible();
    const food = page.getByTestId("compare-row").filter({ hasText: "식비" });
    // Nothing on food in August, 120,000 in September.
    await expect(food).toContainText("₩120,000");
    await expect(food).toContainText("+₩120,000");
    // 교통비 was spent in August and not in September — the row stays, so
    // the disappearance is visible.
    const transport = page.getByTestId("compare-row").filter({ hasText: "교통비" });
    await expect(transport).toContainText("-₩50,000");

    // A year ago is the same calendar dates, not a window shift.
    await page.getByTestId("compare-against-year1").click();
    await expect(page).toHaveURL(/against=year1/);
    await expect(page.getByText("2025-09-01 ~ 2025-09-30")).toBeVisible();
    await expect(page.getByTestId("compare-row").filter({ hasText: "식비" })).toContainText(
      "+₩20,000",
    );
  });

  test("compares balances at each period's end, not what moved in it", async ({ page }) => {
    await seed(currentUserId);
    await page.goto("/compare?from=2026-09-01&to=2026-09-30&scope=balance&against=year1");

    const bank = page.getByTestId("compare-row").filter({ hasText: "은행" });
    // 1,000,000 standing at the end of last September; 1,500,000 at the
    // end of this one. A flow reading would have said 500,000 twice.
    await expect(bank).toContainText("₩1,000,000");
    await expect(bank).toContainText("₩1,500,000");
    await expect(bank).toContainText("+₩500,000");

    // The two scopes are the bar's own switch.
    await page.getByRole("link", { name: "비용 & 수익" }).click();
    await expect(page).toHaveURL(/scope=flow/);
    await expect(page.getByTestId("compare-row").filter({ hasText: "은행" })).toHaveCount(0);
  });
});
