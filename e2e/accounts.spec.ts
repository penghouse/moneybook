import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, sections, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("accounts", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`accounts-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
    ]);
  });

  test("shows the seeded default chart of accounts, grouped", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "계정과목" })).toBeVisible();
    await expect(page.getByText("현금")).toBeVisible();
    await expect(page.getByText("신용카드")).toBeVisible();
    await expect(page.getByText("기초자본")).toBeVisible();
    await expect(page.getByText("식비")).toBeVisible();
    await expect(page.getByText("급여")).toBeVisible();
  });

  test("can add, archive, and reorder an account", async ({ page }) => {
    await page.goto("/accounts");

    await page.getByPlaceholder("예: 식비").fill("반려동물");
    await page
      .locator("form")
      .filter({ has: page.getByPlaceholder("예: 식비") })
      .getByRole("button", { name: "추가" })
      .click();
    await expect(page.getByText("반려동물")).toBeVisible();

    // Archive it, then confirm it disappears from the default view and
    // shows up (dated) once closed accounts are shown.
    await page.getByText("반려동물").click(); // opens the <details> row
    await page.getByRole("button", { name: "보관" }).click();
    await expect(page.getByText("반려동물")).not.toBeVisible();

    await page.getByRole("link", { name: "지난 계정 보기" }).click();
    await expect(page.getByText("반려동물")).toBeVisible();
    // The chip carries the actual end date, which is what the boolean it
    // replaced could not say. Yesterday, not today: active_to is the last
    // day of use, so "stop using it now" means it ended yesterday.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await expect(page.getByText(`~${yesterday}`)).toBeVisible();
  });

  test("a closed account leaves the entry picker but keeps its history and balance", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const card = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "신용카드")),
    });
    const food = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "식비")),
    });
    // Spend on the card, then close it while it still owes money.
    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: "2026-01-15", title: "카드결제" })
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
    await db.update(accounts).set({ activeTo: "2026-02-01" }).where(eq(accounts.id, card!.id));

    // Out of the entry form's picker...
    await page.goto("/");
    const picker = page
      .locator("main form")
      .first()
      .locator('input[placeholder="계정 검색"]')
      .first();
    await picker.click();
    await picker.fill("신용카드");
    await expect(page.getByRole("button", { name: "신용카드", exact: true })).toHaveCount(0);

    // ...but still on the balance sheet, because it still owes ₩40,000.
    // A window must never take real money off a total.
    await page.goto("/assets?asOf=2026-08-05");
    await expect(page.getByText("신용카드")).toBeVisible();
    await expect(page.getByText("₩40,000").first()).toBeVisible();

    // ...and still selectable in the history filter.
    await page.getByRole("link", { name: "입력" }).first().click();
  });

  test("a closed account with nothing left on it folds off the balance sheet", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const card = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "신용카드")),
    });
    const cash = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "현금")),
    });
    const food = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "식비")),
    });
    // Spend on the card, then pay it off in full — balance back to zero.
    for (const [date, from, to] of [
      ["2026-01-15", food!.id, card!.id],
      ["2026-01-20", card!.id, cash!.id],
    ] as const) {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title: "카드" })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: from,
          currency: "KRW",
          amount: 40_000,
          rate: 1,
          baseAmount: 40_000,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: to,
          currency: "KRW",
          amount: 40_000,
          rate: 1,
          baseAmount: 40_000,
        },
      ]);
    }
    await db.update(accounts).set({ activeTo: "2026-02-01" }).where(eq(accounts.id, card!.id));

    await page.goto("/assets?asOf=2026-08-05");
    await expect(page.getByText("신용카드")).toHaveCount(0);
    // As of a date when it was still open, it is back — the sheet is
    // read as of a date, not as of now.
    await page.goto("/assets?asOf=2026-01-25");
    await expect(page.getByText("신용카드")).toBeVisible();
  });

  test("a category groups expense accounts and subtotals them on the income statement", async ({
    page,
  }) => {
    await page.goto("/accounts");

    // File two of the seeded expense accounts under one category.
    for (const name of ["식비", "생활용품"]) {
      const row = page.locator("li").filter({ hasText: name }).first();
      await row.locator("summary").click();
      await row.locator('input[name="category"]').fill("먹고사는 것");
      await row.getByRole("button", { name: "저장" }).click();
      await expect(page.getByRole("heading", { name: "먹고사는 것" }).first()).toBeVisible();
    }

    // The unfiled ones fall under 미분류 rather than disappearing.
    const expenseSection = page.locator("section").filter({ hasText: "비용" }).first();
    await expect(expenseSection.getByRole("heading", { name: "먹고사는 것" })).toBeVisible();
    await expect(expenseSection.getByRole("heading", { name: "미분류" })).toBeVisible();

    // Spend on both, then check the income statement sums the category.
    await page.goto("/");
    for (const [account, amount] of [
      ["식비", "12000"],
      ["생활용품", "3000"],
    ]) {
      const form = page.locator("main form").first();
      for (const [i, name] of [account, "신용카드"].entries()) {
        const inputs = form.locator('input[placeholder="계정 검색"]');
        // The click is what opens the suggestion list; filling alone
        // leaves the combobox closed and there is no option to press.
        await inputs.nth(i).click();
        await inputs.nth(i).fill(name);
        await form.getByRole("button", { name }).first().click();
      }
      await form.locator('input[type="number"]').first().fill(amount);
      await form.locator('input[name="title"]').fill(`${account} 지출`);
      await form.getByRole("button", { name: "저장" }).click();
      await expect(page.getByText(`${account} 지출`)).toBeVisible();
    }

    await page.goto("/income");
    const heading = page
      .locator("div")
      .filter({ hasText: /^먹고사는 것/ })
      .last();
    await expect(heading).toContainText("₩15,000");
  });

  test("moving an account up changes its order within the group", async ({ page }) => {
    await page.goto("/accounts");

    const expenseSection = page.locator("section").filter({ hasText: "비용" }).first();
    // Each <summary> has two spans (name, currency); :first-child is the
    // name one, so this is the ordered list of account names in the group.
    const nameSpans = expenseSection.locator("li summary span:first-child");
    const namesBefore = await nameSpans.allInnerTexts();
    expect(namesBefore).toEqual(["식비", "교통비", "통신비", "생활용품"]);

    await page.getByText("교통비").click();
    await page
      .locator("li")
      .filter({ hasText: "교통비" })
      .getByRole("button", { name: "위로" })
      .click();

    // The submit goes through a server action (fetch + revalidate +
    // re-render), which lands after the click event resolves — poll
    // instead of asserting immediately.
    await expect
      .poll(() => nameSpans.allInnerTexts())
      .toEqual(["교통비", "식비", "통신비", "생활용품"]);
  });

  test("settings: timezone is always editable; base currency locks once a transaction exists", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.selectOption('select[name="timezone"]', "America/New_York");
    await page
      .locator("form")
      .filter({ has: page.locator('select[name="timezone"]') })
      .getByRole("button", { name: "저장" })
      .click();
    await expect(page.getByText("저장되었습니다.")).toBeVisible();

    const section = await db.query.sections.findFirst({
      where: eq(sections.timezone, "America/New_York"),
    });
    expect(section).toBeDefined();

    // Post a minimal balanced transaction directly (entry UI is step 5),
    // then confirm the base-currency guard kicks in.
    const [left, right] = await db.query.accounts.findMany({
      where: eq(accounts.sectionId, section!.id),
      limit: 2,
    });
    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section!.id, date: "2026-01-01", title: "seed" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: left.id,
        currency: "KRW",
        amount: 1000,
        rate: 1,
        baseAmount: 1000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: right.id,
        currency: "KRW",
        amount: 1000,
        rate: 1,
        baseAmount: 1000,
      },
    ]);

    await page.goto("/settings");
    await expect(page.locator('select[name="baseCurrency"]')).toBeDisabled();
  });

  test("settings: a manually entered exchange rate shows up in the recent list", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByText("저장된 환율이 없습니다.")).toBeVisible();

    await page.fill('input[name="date"]', "2026-07-31");
    await page.selectOption('select[name="base"]', "USD");
    await page.fill('input[name="rate"]', "1300");
    await page
      .locator("form")
      .filter({ has: page.locator('input[name="rate"]') })
      .getByRole("button", { name: "저장" })
      .click();

    await expect(page.getByText("2026-07-31 · 1 USD = 1300 KRW")).toBeVisible();
    await expect(page.getByText("수동")).toBeVisible();
  });
});
