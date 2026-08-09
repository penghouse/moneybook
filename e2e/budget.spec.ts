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

  test("a 상위 항목 shows its own usage, and reads as a heading over its accounts", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = (name: string) =>
      db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      });
    const food = await byName("식비");
    const supplies = await byName("생활용품");
    const card = await byName("신용카드");
    const asOf = today(section.timezone);

    // Both under one 상위 항목, so the band above them has something to sum.
    for (const account of [food!, supplies!]) {
      await db.update(accounts).set({ category: "먹고사는 것" }).where(eq(accounts.id, account.id));
    }
    for (const [account, amount] of [
      [food!, 120_000],
      [supplies!, 60_000],
    ] as const) {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date: asOf, title: account.name })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: account.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: card!.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    }

    await page.goto("/budget");
    const band = page.getByTestId("budget-category").filter({ hasText: "먹고사는 것" });

    // No budget under it yet, so there is no share to report.
    await expect(band).toContainText("₩180,000");
    await expect(band).not.toContainText("%");

    const setBudget = async (name: string, amount: string) => {
      const row = page.getByTestId("budget-row").filter({ hasText: name });
      await row.locator('input[name="amount"]').fill(amount);
      await row.getByRole("button", { name: "저장" }).click();
    };
    await setBudget("식비", "200000");
    await setBudget("생활용품", "100000");

    // 180,000 of 300,000 — read off the band, not off any one account.
    await expect.poll(() => band.innerText()).toContain("60%");
    await expect(band).toContainText("₩180,000 / ₩300,000");

    // 식비 alone goes over. The band is the level that says the group as
    // a whole is still within its budget, which is the thing an account
    // row cannot tell you.
    await setBudget("식비", "100000");
    await expect
      .poll(() => page.getByTestId("budget-row").filter({ hasText: "식비" }).innerText())
      .toContain("초과");
    await expect.poll(() => band.innerText()).toContain("90%");
    await expect(band).not.toContainText("초과");

    // Both over, so the sum is too: 180,000 spent against 150,000.
    await setBudget("생활용품", "50000");
    await expect.poll(() => band.innerText()).toContain("초과");
    await expect(band).toContainText("₩30,000");

    // And the band is a heading, not another row: its accounts sit inset
    // from it, which is what says one covers the other.
    const bandBox = (await band.boundingBox())!;
    const rowBox = (await page
      .getByTestId("budget-row")
      .filter({ hasText: "식비" })
      .boundingBox())!;
    expect(rowBox.x).toBeGreaterThan(bandBox.x);
  });

  test("month navigation keeps the selected month in the URL", async ({ page }) => {
    await page.goto("/budget");
    await page.getByRole("link", { name: /다음 달/ }).click();
    await expect(page).toHaveURL(/period=\d{4}-\d{2}/);
  });

  test("the yearly view warns when the twelve months add up past the year's cap", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const year = today(section.timezone).slice(0, 4);

    // Two months of ₩300,000 each, then a ₩500,000 cap for the whole
    // year — the exact situation the year screen exists to surface.
    await page.goto(`/budget?period=${year}-01`);
    const janRow = page.getByTestId("budget-row").filter({ hasText: "식비" });
    await janRow.locator('input[name="amount"]').fill("300000");
    await janRow.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText(/예산 설정.*₩300,000/)).toBeVisible();

    await page.goto(`/budget?period=${year}-02`);
    const febRow = page.getByTestId("budget-row").filter({ hasText: "식비" });
    await febRow.locator('input[name="amount"]').fill("300000");
    await febRow.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText(/예산 설정.*₩300,000/)).toBeVisible();

    await page.getByRole("link", { name: "연간" }).click();
    await expect(page).toHaveURL(new RegExp(`period=${year}$`));

    const yearRow = page.getByTestId("budget-row").filter({ hasText: "식비" });
    await yearRow.locator('input[name="amount"]').fill("500000");
    await yearRow.getByRole("button", { name: "저장" }).click();

    // ₩600,000 of monthly budgets against a ₩500,000 year cap.
    await expect(page.getByText(/월 예산 합계.*₩600,000/).first()).toBeVisible();
    await expect(page.getByText(/연 예산 초과.*₩100,000/).first()).toBeVisible();

    // The month screen is untouched by any of it.
    await page.getByRole("link", { name: "월간" }).click();
    await expect(page).toHaveURL(/period=\d{4}-\d{2}/);
  });
});
