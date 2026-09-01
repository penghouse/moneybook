import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, exchangeRates, transactionLines, transactions } from "../db/schema";
import { addMonths, monthRange, today, yearMonthOf } from "../lib/date";
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

  test("a 상위 그룹 on the balance sheet folds its accounts away", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const opening = await byName("기초자본");
    await db.update(accounts).set({ category: "유동성자금" }).where(eq(accounts.id, bank.id));

    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: "2026-08-01", title: "기초" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: bank.id,
        currency: "KRW",
        amount: 4_000_000,
        rate: 1,
        baseAmount: 4_000_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: opening.id,
        currency: "KRW",
        amount: 4_000_000,
        rate: 1,
        baseAmount: 4_000_000,
      },
    ]);

    await page.goto("/assets?asOf=2026-08-06");
    const band = page.getByTestId("assets-category").filter({ hasText: "유동성자금" });
    await expect(band).toContainText("₩4,000,000");
    await expect(page.getByRole("link", { name: /은행/ })).toBeVisible();

    // Folded, the subtotal stays and the accounts under it go.
    await band.click();
    await expect(page.getByRole("link", { name: /은행/ })).toHaveCount(0);
    await expect(band).toContainText("₩4,000,000");

    // Stepping the 기준일 is an ordinary navigation and must not undo it.
    await page.getByRole("link", { name: /이전 달/ }).click();
    await expect(
      page.getByTestId("assets-category").filter({ hasText: "유동성자금" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("the 기준일 label picks a day, and the header carries no form", async ({ page }) => {
    await page.goto("/assets?asOf=2026-08-06&step=month");
    // 기준일 / 조회 used to stand in the header permanently. The bar below
    // already held the arrows and the 월간/연간 switch, so the date moved
    // in with them.
    await expect(page.locator('form[action="/assets"]')).toHaveCount(0);

    await page.getByTestId("period-jump").click();
    const picker = page.getByTestId("period-jump-input");
    await expect(picker).toHaveAttribute("type", "date");
    await picker.fill("2026-01-25");
    await expect(page).toHaveURL(/asOf=2026-01-25/);
    // The unit travels with the date rather than resetting.
    await expect(page).toHaveURL(/step=month/);
    await expect(page.getByTestId("period-jump")).toHaveText("2026-01-25");

    // And the arrows still step from wherever it landed.
    await page.getByRole("link", { name: /이전 달/ }).click();
    await expect(page).toHaveURL(/asOf=2025-12-25/);
  });

  test("the year toggle changes what the arrows step, on both reports", async ({ page }) => {
    // The income statement's unit is derived from its range, so 연간
    // widens the range and the arrows follow it without being told.
    await page.goto("/income?from=2026-08-01&to=2026-08-31");
    await page.getByRole("link", { name: "연간" }).click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-12-31/);
    await page.getByRole("link", { name: /이전 해/ }).click();
    await expect(page).toHaveURL(/from=2025-01-01&to=2025-12-31/);

    // A date cannot say which unit it belongs to, so the balance sheet
    // carries the step in the URL. Switching to years snaps to the
    // year's end — a past year, so it is not capped at today.
    await page.goto("/assets?asOf=2025-08-06");
    await page.getByRole("link", { name: "연간" }).click();
    await expect(page).toHaveURL(/asOf=2025-12-31&step=year/);
    await page.getByRole("link", { name: /이전 해/ }).click();
    await expect(page).toHaveURL(/asOf=2024-12-31&step=year/);
  });

  test("the balance sheet groups its accounts under their 상위 그룹, with a subtotal", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const cash = await byName("현금");
    const opening = await byName("기초자본");

    for (const account of [bank, cash]) {
      await db.update(accounts).set({ category: "유동성자금" }).where(eq(accounts.id, account.id));
    }
    for (const [account, amount] of [
      [bank, 3_000_000],
      [cash, 500_000],
    ] as const) {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date: "2026-08-01", title: "기초" })
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
          accountId: opening.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    }

    // 기간손익 and 예산 both grouped by 상위 그룹; the balance sheet was
    // the one report that did not, so a book organised into 유동성자금
    // showed that grouping everywhere except here.
    await page.goto("/assets?asOf=2026-08-06");
    const band = page.locator("section").filter({ hasText: "자산" }).getByText("유동성자금");
    await expect(band.first()).toBeVisible();
    await expect(page.getByText(/유동성자금[\s\S]*₩3,500,000/).first()).toBeVisible();
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
    await expect(page.locator("main details[open] select[name='accountId']")).toBeVisible();
    // The period is the bar's, not the filter's: two date boxes repeating
    // what the arrows above them already say was the third control on
    // this screen that could change the same thing.
    await expect(page.locator("main details[open] input[type='date'][name='from']")).toHaveCount(0);
    // Carried as a hidden field, so 조회 does not drop it.
    await expect(page.locator("main details[open] input[type='hidden'][name='from']")).toHaveValue(
      "2026-08-01",
    );
    await expect(page.getByTestId("range-jump")).toHaveText("2026-08");

    await page.getByRole("link", { name: /이전 달/ }).click();
    await expect(page).toHaveURL(/from=2026-07-01&to=2026-07-31/);
    await expect(page).toHaveURL(/accountId=/);

    // Applying another filter keeps the period the bar is showing.
    await page.locator("main details[open] input[name='q']").fill("카드");
    await page.getByRole("button", { name: "조회" }).click();
    await expect(page).toHaveURL(/from=2026-07-01&to=2026-07-31/);

    // And the label picks any range, carrying the account with it.
    await page.getByTestId("range-jump").click();
    await page.getByTestId("range-jump-from").fill("2026-08-01");
    await page.getByTestId("range-jump-to").fill("2026-08-31");
    await page.getByTestId("range-jump-confirm").click();
    await expect(page).toHaveURL(/from=2026-08-01&to=2026-08-31/);
    await expect(page).toHaveURL(/accountId=/);
    await expect(page).toHaveURL(/q=%EC%B9%B4%EB%93%9C/);
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
    // Paid back under a 적요 that notes what the payment was — the
    // parenthesis describes the transaction, not a different person.
    await lend("2026-05-01", "가람미용기기 (일부 상환)", 300_000, true);
    await lend("2026-06-01", "한석핸드폰", 200_000);
    await lend("2026-06-02", "한석상여", 400_000);
    await lend("2026-07-01", "한석상여(리텐션뱉)", 400_000, true);

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
    // Netted, not listed twice — and under the bare name, with the
    // repayment's parenthetical nowhere in the list.
    await expect(row("가람미용기기")).toHaveCount(1);
    await expect(row("가람미용기기")).not.toContainText("₩800,000");
    await expect(row("일부 상환")).toHaveCount(0);
    // 한석상여 borrowed and paid back the same amount under two spellings
    // of one name, so they are square and off the list entirely.
    await expect(row("한석상여")).toHaveCount(0);

    // August alone contains none of these transactions, and the
    // breakdown must not be narrowed by it — that would report everyone
    // as settled up.
    await expect(page.getByText("거래가 없습니다.")).toBeVisible();
  });

  test("income page shows this month's income/expense/net, and links to its charts", async ({
    page,
  }) => {
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
    // The trend moved to its own page; the statement is a list now.
    await expect(page.locator("svg[role='group']")).toHaveCount(0);

    // And it is one press away, on the month being read.
    await page.getByRole("link", { name: "그래프 보기" }).click();
    await expect(page).toHaveURL(/\/income\/chart/);
    await expect(page.getByRole("heading", { name: "기간손익 그래프" })).toBeVisible();
  });

  test("조회 stays on the row with the two dates it belongs to", async ({ page }) => {
    // Both date boxes stood at their natural width — 174px each — which
    // with the button came to more than the row had, so 조회 dropped to
    // a line of its own.
    for (const width of [393, 900]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/income");
      const form = page.locator('form[action="/income"]');
      await expect(form.getByRole("button")).toBeVisible();

      const row = await form.evaluate((el) => {
        const kids = [...el.children].map((k) => k.getBoundingClientRect());
        const dates = [...el.querySelectorAll('input[type="date"]')].map(
          (i) => i.getBoundingClientRect().width,
        );
        return { bottoms: new Set(kids.map((r) => Math.round(r.bottom))).size, dates };
      });

      expect(row.bottoms).toBe(1);
      // And the dates keep enough width to read: a date input clips
      // rather than wraps, and under about 8.5rem the year loses a digit
      // with nothing on screen to say so.
      for (const w of row.dates) expect(w).toBeGreaterThanOrEqual(136);
    }
  });

  test("both chart screens page by the window's own length", async ({ page }) => {
    // Twelve whole months, so the arrows must land on the twelve before
    // and after — not eleven of the same twelve.
    await page.goto("/assets/chart?from=2026-01-01&to=2026-12-31");
    await page.getByRole("link", { name: /이전 기간/ }).click();
    await expect(page).toHaveURL(/from=2025-01-01&to=2025-12-31/);
    await page.getByRole("link", { name: /다음 기간/ }).click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-12-31/);

    await page.goto("/income/chart?from=2026-07-01&to=2026-09-30&unit=month");
    await page.getByRole("link", { name: /이전 기간/ }).click();
    await expect(page).toHaveURL(/from=2026-04-01&to=2026-06-30/);
    // The bar width travels with the window rather than resetting.
    await expect(page).toHaveURL(/unit=month/);
  });

  test("both chart screens pick their range from the label, with no header form", async ({
    page,
  }) => {
    await page.goto("/income/chart?from=2026-07-01&to=2026-09-30&unit=month");

    // 시작 / 끝 / 조회 used to stand in the header permanently. The bar
    // below already held the arrows and the 월간/연간 switch, so the
    // range moved in with them.
    await expect(page.locator('form[action="/income/chart"]')).toHaveCount(0);

    await page.getByTestId("range-jump").click();
    await page.getByTestId("range-jump-from").fill("2026-01-01");
    await page.getByTestId("range-jump-to").fill("2026-03-31");
    await page.getByTestId("range-jump-confirm").click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-03-31/);
    // The bar width the reader was on travels with the new range.
    await expect(page).toHaveURL(/unit=month/);
    // The year is said once when both ends share it — the repeated half
    // was what pushed this label into truncating on a phone.
    await expect(page.getByTestId("range-jump")).toHaveText("2026-01-01 ~ 03-31");

    // Picked backwards is a slip, not an empty range.
    await page.getByTestId("range-jump").click();
    await page.getByTestId("range-jump-from").fill("2026-06-30");
    await page.getByTestId("range-jump-to").fill("2026-04-01");
    await page.getByTestId("range-jump-confirm").click();
    await expect(page).toHaveURL(/from=2026-04-01&to=2026-06-30/);

    // And the arrows still step from wherever it landed.
    await page.getByRole("link", { name: /이전 기간/ }).click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-03-31/);

    // The net-worth chart reads the same kind of period, so it asks for
    // it the same way rather than keeping a form of its own.
    await page.goto("/assets/chart?from=2026-07-01&to=2026-09-30");
    await expect(page.locator('form[action="/assets/chart"]')).toHaveCount(0);
    await page.getByTestId("range-jump").click();
    await page.getByTestId("range-jump-from").fill("2026-01-01");
    await page.getByTestId("range-jump-to").fill("2026-03-31");
    await page.getByTestId("range-jump-confirm").click();
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-03-31/);
  });

  test("the income chart hovers a bar for its numbers, and switches month/year", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const salary = await byName("급여");
    const food = await byName("식비");
    const bank = await byName("은행");

    const post = async (date: string, title: string, from: string, to: string, amount: number) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: from,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: to,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    };
    // Two months apart so hovering one bar cannot pick up the other's
    // numbers, and one of them a loss so the sign is exercised.
    await post("2026-07-25", "급여", bank.id, salary.id, 2_000_000);
    await post("2026-07-26", "식비", food.id, bank.id, 300_000);
    await post("2026-08-10", "식비", food.id, bank.id, 500_000);

    await page.goto("/income/chart?from=2026-07-01&to=2026-08-31&unit=month");
    const chart = page.locator("svg[role='group']");
    await expect(chart).toBeVisible();

    // Nothing is hovered yet, so nothing is being read out.
    await expect(page.getByTestId("chart-tooltip")).toHaveCount(0);

    // Hover the first bar — July: 2,000,000 in, 300,000 out.
    const bars = page.getByTestId("chart-bar-hit");
    await expect(bars).toHaveCount(2);
    await bars.nth(0).hover();
    const tip = page.getByTestId("chart-tooltip");
    await expect(tip).toContainText("2026-07");
    await expect(tip).toContainText("₩2,000,000");
    await expect(tip).toContainText("₩300,000");
    await expect(tip).toContainText("₩1,700,000");

    // The second bar reads its own month, not the first one's.
    await bars.nth(1).hover();
    await expect(tip).toContainText("2026-08");
    await expect(tip).toContainText("-₩500,000");

    // Keyboard gets the same readout — the numbers are not hover-only.
    await bars.nth(0).focus();
    await expect(tip).toContainText("2026-07");

    // Years redraw the same range as one bar per year.
    await page.getByRole("link", { name: "연간" }).click();
    await expect(page).toHaveURL(/unit=year/);
    await expect(page.getByTestId("chart-bar-hit")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "연도별 추이" })).toBeVisible();

    // And every number the readout shows is in the table too.
    await page.getByText("표로 보기").click();
    const row = page.getByRole("row").filter({ hasText: "2026" });
    await expect(row).toContainText("₩2,000,000");
    await expect(row).toContainText("₩800,000");
    await expect(row).toContainText("₩1,200,000");
  });

  test("an income statement row opens its transactions, with its share of the period", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const food = await byName("식비");
    const transport = await byName("교통비");
    const card = await byName("신용카드");

    const spend = async (account: string, amount: number, title: string) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date: "2026-08-10", title })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: account,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: card.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    };
    await spend(food.id, 300_000, "장보기");
    await spend(food.id, 150_000, "장보기(주말)");
    await spend(food.id, 300_000, "커피");
    await spend(transport.id, 250_000, "교통카드");

    await page.goto("/income?from=2026-08-01&to=2026-08-31");
    await page.getByRole("link", { name: /식비/ }).click();
    await expect(page).toHaveURL(/accountId=[^&]+&from=2026-08-01&to=2026-08-31/);
    await expect(page.getByText("장보기").first()).toBeVisible();

    // What is *inside* 식비, not how 식비 compares with 교통비 — that is
    // the statement one screen back. Titles are grouped without their
    // parentheses, so 장보기 and 장보기(주말) are one line.
    const share = page.getByRole("list", { name: "적요별 비중" });
    await expect(share.locator("li").filter({ hasText: "장보기" })).toContainText("60.0%");
    await expect(share.locator("li").filter({ hasText: "커피" })).toContainText("40.0%");
    await expect(share.locator("li")).toHaveCount(2);
  });

  test("a row's account names open their own month, and its tags read as filters", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const food = await byName("식비");
    const card = await byName("신용카드");

    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: "2026-08-11", title: "장보기", memo: "주말 #낭비" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: food.id,
        currency: "KRW",
        amount: 84_000,
        rate: 1,
        baseAmount: 84_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: card.id,
        currency: "KRW",
        amount: 84_000,
        rate: 1,
        baseAmount: 84_000,
      },
    ]);

    await page.goto("/?from=2026-08-01&to=2026-08-31");
    const row = page.getByRole("listitem").filter({ hasText: "장보기" });

    // The strip under the title goes somewhere; the title itself still
    // opens the editor. Both live in the same row without fighting.
    await row.getByRole("link", { name: "신용카드" }).click();
    await expect(page).toHaveURL(new RegExp(`accountId=${card.id}&from=2026-08-01&to=2026-08-31`));
    await expect(page.getByRole("heading", { name: "신용카드" })).toBeVisible();

    await page.goBack();
    await page
      .getByRole("listitem")
      .filter({ hasText: "장보기" })
      .getByRole("link", { name: "식비" })
      .click();
    await expect(page).toHaveURL(new RegExp(`accountId=${food.id}`));

    await page.goBack();
    // A tag in a memo is a filter, so it reads as one and presses as one.
    await page
      .getByRole("listitem")
      .filter({ hasText: "장보기" })
      .getByRole("link", { name: "#낭비" })
      .click();
    await expect(page).toHaveURL(/tag=%EB%82%AD%EB%B9%84|tag=낭비/);
    await expect(page.getByText("장보기")).toBeVisible();

    // The title still opens the editor.
    await page.goto("/?from=2026-08-01&to=2026-08-31");
    await page.getByRole("button", { name: /장보기/ }).click();
    await expect(page.getByRole("dialog", { name: "장보기" })).toBeVisible();
  });

  test("the by-item chart is switched on and off from its legend", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const cash = await byName("현금");
    const opening = await byName("기초자본");

    await db.update(accounts).set({ category: "유동성자금" }).where(eq(accounts.id, bank.id));
    await db.update(accounts).set({ category: "현금성" }).where(eq(accounts.id, cash.id));

    const post = async (date: string, account: string, amount: number) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title: "기초" })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: account,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: opening.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    };
    await post("2026-01-15", bank.id, 1_000_000);
    await post("2026-02-15", bank.id, 500_000);
    await post("2026-01-15", cash.id, 200_000);

    await page.goto("/assets/chart?from=2026-01-01&to=2026-03-31");
    const legend = page.getByTestId("series-legend");
    await expect(legend.getByRole("button", { name: "유동성자금" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A balance carries forward: March has no transactions of its own
    // and still holds February's money.
    await page.getByTestId("series-hit").nth(2).hover();
    const tip = page.getByTestId("series-tooltip");
    await expect(tip).toContainText("2026-03");
    await expect(tip).toContainText("₩1,500,000");

    // The legend is the switch — turning one off takes its line and its
    // row out of the readout.
    await legend.getByRole("button", { name: "유동성자금" }).click();
    await expect(legend.getByRole("button", { name: "유동성자금" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByTestId("series-hit").nth(2).hover();
    await expect(page.getByTestId("series-tooltip")).not.toContainText("유동성자금");

    // ...and back on, without disturbing the one that stayed.
    await legend.getByRole("button", { name: "유동성자금" }).click();
    await page.getByTestId("series-hit").nth(2).hover();
    await expect(page.getByTestId("series-tooltip")).toContainText("유동성자금");

    // The choice survives a navigation. Stepping the window is the
    // ordinary way to use this screen, and it re-renders the page from
    // the server — a chart that came back with the default two on made
    // comparing one item across windows impossible.
    await legend.getByRole("button", { name: "현금성" }).click();
    await expect(legend.getByRole("button", { name: "현금성" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await page.getByRole("link", { name: "이전 기간" }).click();
    await expect(page).toHaveURL(/from=2025-10-01/);
    const afterStep = page.getByTestId("series-legend");
    await expect(afterStep.getByRole("button", { name: "현금성" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(afterStep.getByRole("button", { name: "유동성자금" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // And a fresh visit, not just a step — this is a preference, not
    // something carried in the URL.
    await page.goto("/assets/chart?from=2026-01-01&to=2026-03-31");
    await expect(
      page.getByTestId("series-legend").getByRole("button", { name: "현금성" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("past today every line breaks, and the budget runs on beside them", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const opening = await byName("기초자본");
    // So the by-item chart below has a series to draw at all.
    await db.update(accounts).set({ category: "유동성자금" }).where(eq(accounts.id, bank.id));

    const thisMonth = yearMonthOf(today(section.timezone));
    const lastMonth = addMonths(thisMonth, -1);
    const nextMonth = addMonths(thisMonth, 1);
    const monthAfter = addMonths(thisMonth, 2);

    const post = async (date: string, amount: number) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title: "기초" })
        .returning();
      await db.insert(transactionLines).values([
        {
          transactionId: tx.id,
          side: "left",
          accountId: bank.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: opening.id,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    };
    await post(`${lastMonth}-15`, 10_000_000);
    // Dated two months out — a real entry the reader made in advance,
    // and the reason a future month is not simply cut off the chart.
    await post(`${monthAfter}-10`, 3_000_000);

    // Next month is budgeted — earn 4,000,000, spend 1,500,000 — and the
    // one after it is not.
    await page.goto(`/budget?period=${nextMonth}`);
    const row = (name: string) => page.getByTestId("budget-row").filter({ hasText: name });
    await row("급여").locator('input[name="amount"]').fill("4000000");
    await row("급여").getByRole("button", { name: "저장" }).click();
    await expect(row("급여").locator('input[name="amount"]')).toBeHidden();
    await row("식비").locator('input[name="amount"]').fill("1500000");
    await row("식비").getByRole("button", { name: "저장" }).click();
    await expect(row("식비").locator('input[name="amount"]')).toBeHidden();

    await page.goto(
      `/assets/chart?from=${monthRange(lastMonth).from}&to=${monthRange(monthAfter).to}`,
    );
    // The ledger's own line carries on past today, broken rather than
    // solid, and the budget's forecast runs beside it.
    await expect(page.getByTestId("net-worth-ahead-netWorth")).toBeVisible();
    await expect(page.getByTestId("net-worth-projected")).toBeVisible();
    await expect(page.getByTestId("net-worth-legend")).toContainText("예상 순자산");

    // The table is the same numbers, so it says what the strokes do.
    await page.getByText("표로 보기").first().click();
    const rowFor = (month: string) => page.getByRole("row").filter({ hasText: month });
    await expect(rowFor(thisMonth)).toContainText("₩10,000,000");
    await expect(rowFor(thisMonth)).not.toContainText("미확정");

    // Next month has no entry of its own, so the balance carries — and
    // beside it, 10,000,000 plus the 2,500,000 the budget expects to stay.
    await expect(rowFor(nextMonth)).toContainText("미확정");
    await expect(rowFor(nextMonth)).toContainText("₩10,000,000");
    await expect(rowFor(nextMonth)).toContainText("예상 ₩12,500,000");

    // The month after has an entry dated into it. It is drawn, not cut —
    // and the forecast stops there, because the budget does.
    await expect(rowFor(monthAfter)).toContainText("미확정");
    await expect(rowFor(monthAfter)).toContainText("₩13,000,000");
    await expect(rowFor(monthAfter)).not.toContainText("예상");

    // The by-item chart on the same page breaks in the same place.
    await expect(page.getByTestId("series-ahead").first()).toBeVisible();
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
    const legend = page.getByTestId("net-worth-legend");
    for (const name of ["자산", "부채", "순자산"]) {
      await expect(legend.getByText(name, { exact: true })).toBeVisible();
    }

    // Gridlines carry the values nothing is directly labelled with, so
    // the scale has to be readable without hovering anything.
    await expect(trend.getByText("0", { exact: true }).first()).toBeVisible();

    // Hovering a month reports all three figures for it at once —
    // reading the gap between two lines is not a way to learn a number.
    await page.getByTestId("net-worth-hit").last().hover();
    const readout = page.getByTestId("net-worth-tooltip");
    await expect(readout).toBeVisible();
    for (const name of ["자산", "부채", "순자산"]) {
      await expect(readout.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(readout.getByText("₩5,000,000").first()).toBeVisible();

    // A chart nobody can read still has to give up its numbers.
    await page.getByText("표로 보기").first().click();
    await expect(page.getByRole("table").first()).toBeVisible();

    // Composition is a share of the whole, so it states the share.
    await expect(page.getByRole("list", { name: "비중" }).getByText("%").first()).toBeVisible();
  });
});
