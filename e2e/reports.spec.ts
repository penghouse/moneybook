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

  test("the year toggle changes what the arrows step, on both reports", async ({ page }) => {
    // The income statement's unit is derived from its range, so 연간
    // widens the range and the arrows follow it without being told.
    await page.goto("/income?from=2026-08-01&to=2026-08-31");
    await page.getByRole("link", { name: "연간" }).click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-12-31/);
    await page.getByRole("link", { name: /이전 해/ }).click();
    await expect(page).toHaveURL(/from=2025-01-01&to=2025-12-31/);
    await expect(page.getByText("최근 5년 추이")).toBeVisible();

    // A date cannot say which unit it belongs to, so the balance sheet
    // carries the step in the URL. Switching to years snaps to the
    // year's end — a past year, so it is not capped at today.
    await page.goto("/assets?asOf=2025-08-06");
    await page.getByRole("link", { name: "연간" }).click();
    await expect(page).toHaveURL(/asOf=2025-12-31&step=year/);
    await page.getByRole("link", { name: /이전 해/ }).click();
    await expect(page).toHaveURL(/asOf=2024-12-31&step=year/);
  });

  test("a balance sheet row opens that period's transactions for the account", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = (name: string) =>
      db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      });
    const card = await byName("신용카드");
    const food = await byName("식비");

    // The sheet lists accounts the ledger has touched, so the row has to
    // exist before it can be pressed.
    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: "2026-08-03", title: "카드 결제" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: food!.id,
        currency: "KRW",
        amount: 40_000,
        rate: 1,
        baseAmount: 40_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: card!.id,
        currency: "KRW",
        amount: 40_000,
        rate: 1,
        baseAmount: 40_000,
      },
    ]);

    await page.goto("/assets?asOf=2026-08-06");
    await page.getByRole("link", { name: /신용카드/ }).click();

    // The month on screen, filtered to the account whose row was pressed
    // — and the running-balance caption names it, which is how the list
    // says it is showing one account rather than net worth.
    await expect(page).toHaveURL(/accountId=[^&]+&from=2026-08-01&to=2026-08-31/);
    await expect(page.getByText("잔액 · 신용카드")).toBeVisible();

    // On one account's ledger the screen is for reading, not typing: the
    // entry form steps aside, the filter is already open, and the month
    // has arrows so stepping it is not a trip through a date picker.
    await expect(page.getByRole("heading", { name: "신용카드" })).toBeVisible();
    // #entry is the create form's own wrapper; each transaction row still
    // carries an edit form, pickers and all, so counting pickers page-wide
    // would never reach zero.
    await expect(page.locator("#entry")).toHaveCount(0);
    await expect(page.locator("main details[open] input[name='from']")).toBeVisible();

    await page.getByRole("link", { name: /이전 달/ }).click();
    await expect(page).toHaveURL(/from=2026-07-01&to=2026-07-31/);
    await expect(page).toHaveURL(/accountId=/);
  });

  test("a 거래처관리 account breaks its balance down by counterparty", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const [receivable] = await db
      .insert(accounts)
      .values({
        sectionId: section.id,
        group: "asset",
        name: "받을돈",
        currency: "KRW",
        sortOrder: 200,
        tracksCounterparties: true,
      })
      .returning();
    const bank = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "은행")),
    });

    const lend = async (date: string, who: string, amount: number, back = false) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title: who })
        .returning();
      const [to, from] = back ? [bank!.id, receivable.id] : [receivable.id, bank!.id];
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: to,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: from,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    };

    await lend("2026-03-01", "맥북에어", 500_000);
    await lend("2026-04-01", "가람미용기기", 800_000);
    await lend("2026-05-01", "가람미용기기", 300_000, true);
    await lend("2026-06-01", "한석핸드폰", 200_000);

    // Reached the way the user reaches it: the balance sheet row.
    await page.goto("/assets?asOf=2026-08-06");
    await page.getByRole("link", { name: /받을돈/ }).click();

    // Asserted row by row: two counterparties legitimately land on the
    // same amount here, so a page-wide text match would be ambiguous —
    // and that 800,000 minus 300,000 nets to the same 500,000 as the
    // untouched 맥북에어 is the point of the test.
    const row = (who: string) =>
      page.getByRole("list", { name: "거래처별 잔액" }).locator("li").filter({ hasText: who });
    await expect(row("맥북에어")).toContainText("₩500,000");
    await expect(row("가람미용기기")).toContainText("₩500,000");
    await expect(row("한석핸드폰")).toContainText("₩200,000");
    // Netted, not listed twice.
    await expect(row("가람미용기기")).toHaveCount(1);
    await expect(row("가람미용기기")).not.toContainText("₩800,000");

    // August alone contains none of these transactions, and the
    // breakdown must not be narrowed by it — that would report everyone
    // as settled up.
    await expect(page.getByText("거래가 없습니다.")).toBeVisible();
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
