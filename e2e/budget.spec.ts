import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { today } from "../lib/date";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("budget", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`budget-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: seeded.token,
        url: "http://localhost:3000",
      },
    ]);
  });

  test("setting a budget shows spend, remaining, and switches to over once exceeded", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, {
      userId: currentUserId,
      locale: "ko",
    });
    // Many other tests' users also seed a "식비" account by this point in
    // a full-suite run — scope by this test's own section, or
    // findFirst() can silently pick up a different user's account.
    const food = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "식비")),
    });
    const card = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "신용카드")),
    });
    const asOf = today(section.timezone);

    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: asOf, title: "식비" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: food!.id,
        currency: "KRW",
        amount: 200_000,
        rate: 1,
        baseAmount: 200_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: card!.id,
        currency: "KRW",
        amount: 200_000,
        rate: 1,
        baseAmount: 200_000,
      },
    ]);

    await page.goto("/budget");
    // Addressed by testid rather than by tag: the row is whatever element
    // the current layout uses, and that has already changed once.
    const row = page.getByTestId("budget-row").filter({ hasText: "식비" });
    await row.locator('input[name="amount"]').fill("300000");
    await row.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText(/지출.*₩200,000/)).toBeVisible();
    await expect(page.getByText(/예산 설정.*₩300,000.*67%/)).toBeVisible();
    await expect(page.getByText(/잔여.*₩100,000/)).toBeVisible();

    const row2 = page.getByTestId("budget-row").filter({ hasText: "식비" });
    await row2.locator('input[name="amount"]').fill("150000");
    await row2.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText(/초과.*₩50,000/)).toBeVisible();
  });

  test("month navigation keeps the selected month in the URL", async ({ page }) => {
    await page.goto("/budget");
    await page.getByRole("link", { name: /다음 달/ }).click();
    await expect(page).toHaveURL(/yearMonth=\d{4}-\d{2}/);
  });
});
