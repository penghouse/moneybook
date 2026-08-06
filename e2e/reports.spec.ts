import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, exchangeRates, transactionLines, transactions } from "../db/schema";
import { today } from "../lib/date";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("reports", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`reports-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
    ]);
  });

  test("assets page shows totals, net worth, and unrealized FX, then revalue zeroes it out", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const [usd] = await db
      .insert(accounts)
      .values({
        sectionId: section.id,
        group: "asset",
        name: "달러예금",
        currency: "USD",
        sortOrder: 100,
      })
      .returning();
    // Scoped by this test's own section — many other tests' users also
    // seed a "은행" account, and findFirst() would otherwise silently
    // pick up whichever one happens to sort first.
    const bank = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "은행")),
    });

    const asOf = today(section.timezone);

    // Seed a balanced transaction directly (entry UI already covered by
    // entry.spec.ts) establishing the USD book balance.
    const [entry] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: asOf, title: "환전" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: entry.id,
        side: "left",
        accountId: usd.id,
        currency: "USD",
        amount: 100_000,
        rate: 1300,
        baseAmount: 1_300_000,
      },
      {
        transactionId: entry.id,
        side: "right",
        accountId: bank!.id,
        currency: "KRW",
        amount: 1_300_000,
        rate: 1,
        baseAmount: 1_300_000,
      },
    ]);

    // Current rate differs from the booked rate, so there's something to revalue.
    await db
      .insert(exchangeRates)
      .values({ date: asOf, base: "USD", quote: "KRW", rate: 1380, source: "api" })
      .onConflictDoUpdate({
        target: [exchangeRates.date, exchangeRates.base, exchangeRates.quote],
        set: { rate: 1380, source: "api" },
      });

    await page.goto("/assets");
    await expect(page.getByText("달러예금")).toBeVisible();
    await expect(page.getByText(/장부가.*\₩1,300,000/)).toBeVisible();
    await expect(page.getByText(/현재가.*\₩1,380,000/)).toBeVisible();
    await expect(page.getByText(/미반영.*\+₩80,000/)).toBeVisible();

    await page.getByRole("button", { name: "환율 반영" }).click();
    await expect(page.getByText("반영되었습니다.")).toBeVisible();
    await expect(page.getByText("달러예금")).toBeVisible();
    await expect(page.getByText("미반영")).not.toBeVisible();
    await expect(page.getByText(/장부가.*\₩1,380,000/)).toBeVisible();
  });

  test("month arrows step the balance sheet and the income statement", async ({ page }) => {
    // The balance sheet reads at an instant, so its arrows move that
    // instant; the income statement reads a period, so its arrows move
    // to the adjacent whole month. Both are asserted on the URL the
    // arrow produces, which is the contract each page's query reads.
    await page.goto("/assets?asOf=2026-08-06");
    await page.getByRole("link", { name: /이전 달/ }).click();
    await expect(page).toHaveURL(/asOf=2026-07-06/);
    await page.getByRole("link", { name: /다음 달/ }).click();
    await expect(page).toHaveURL(/asOf=2026-08-06/);

    await page.goto("/income?from=2026-08-01&to=2026-08-31");
    await page.getByRole("link", { name: /이전 달/ }).click();
    await expect(page).toHaveURL(/from=2026-07-01&to=2026-07-31/);
  });

  test("income page shows this month's income/expense/net and a trend chart", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = (name: string) =>
      db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      });
    const salary = await byName("급여");
    const food = await byName("식비");
    const bank = await byName("은행");
    const asOf = today(section.timezone);

    const [tx1] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: asOf, title: "급여" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx1.id,
        side: "left",
        accountId: bank!.id,
        currency: "KRW",
        amount: 3_000_000,
        rate: 1,
        baseAmount: 3_000_000,
      },
      {
        transactionId: tx1.id,
        side: "right",
        accountId: salary!.id,
        currency: "KRW",
        amount: 3_000_000,
        rate: 1,
        baseAmount: 3_000_000,
      },
    ]);
    const [tx2] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: asOf, title: "식비" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx2.id,
        side: "left",
        accountId: food!.id,
        currency: "KRW",
        amount: 20_000,
        rate: 1,
        baseAmount: 20_000,
      },
      {
        transactionId: tx2.id,
        side: "right",
        accountId: bank!.id,
        currency: "KRW",
        amount: 20_000,
        rate: 1,
        baseAmount: 20_000,
      },
    ]);

    await page.goto("/income");
    await expect(page.getByText(/수익 합계.*\₩3,000,000/)).toBeVisible();
    await expect(page.getByText(/비용 합계.*\₩20,000/)).toBeVisible();
    await expect(page.getByText(/순이익.*\₩2,980,000/)).toBeVisible();
    await expect(page.getByText("급여")).toBeVisible();
    await expect(page.getByText("식비")).toBeVisible();
    await expect(page.locator("svg[role='group']")).toBeVisible();
  });

  test("the chart page draws all three charts, each with its numbers in a table", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const equity = await byName("기초자본");
    const asOf = today(section.timezone);

    // An empty book draws no charts, and that is the correct behaviour —
    // so this test has to put something in it first.
    const [opening] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: asOf, title: "기초잔액", kind: "opening" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: opening.id,
        side: "left",
        accountId: bank.id,
        currency: "KRW",
        amount: 5_000_000,
        rate: 1,
        baseAmount: 5_000_000,
      },
      {
        transactionId: opening.id,
        side: "right",
        accountId: equity.id,
        currency: "KRW",
        amount: 5_000_000,
        rate: 1,
        baseAmount: 5_000_000,
      },
    ]);

    await page.goto("/assets/chart");

    // Addressed by selector rather than getByRole, as in the income trend
    // test — an <svg role="group"> does not resolve there.
    await expect(page.getByRole("heading", { name: "순자산 추이" })).toBeVisible();
    const trend = page.locator('svg[role="group"][aria-label="순자산 추이"]');
    await expect(trend).toBeVisible();
    await expect(page.getByRole("heading", { name: "자산 구성" })).toBeVisible();

    // One chart carries all three lines, so the legend has to name all
    // three — colour matching alone is never the identity channel.
    const legend = trend.locator("xpath=preceding-sibling::div[1]");
    for (const name of ["자산", "부채", "순자산"]) {
      await expect(legend.getByText(name, { exact: true })).toBeVisible();
    }

    // A chart nobody can read still has to give up its numbers.
    await page.getByText("표로 보기").first().click();
    await expect(page.getByRole("table").first()).toBeVisible();

    // Composition is a share of the whole, so it states the share.
    await expect(page.getByRole("list", { name: "비중" }).getByText("%").first()).toBeVisible();
  });
});
