import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, budgets, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

/**
 * The screen blends the ledger behind with the budget ahead, so every
 * figure it shows depends on which month it is being read in. A fixed
 * year would test one arrangement in January and a different one in
 * December; these tests build the year around today instead.
 */
const NOW = new Date();
const YEAR = String(NOW.getFullYear());
const THIS_MONTH = NOW.getMonth() + 1;
const month = (n: number) => `${YEAR}-${String(n).padStart(2, "0")}`;

test.describe("year overview", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`year-${testInfo.testId}@example.com`);
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
    const salary = await byName("급여");
    const card = await byName("신용카드");
    const bank = await byName("은행");

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

    // Every month of the year is budgeted, both sides.
    await db.insert(budgets).values(
      Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) => [
        {
          sectionId: section.id,
          accountId: food.id,
          period: "month" as const,
          periodKey: month(n),
          amount: 600_000,
        },
        {
          sectionId: section.id,
          accountId: salary.id,
          period: "month" as const,
          periodKey: month(n),
          amount: 3_000_000,
        },
      ]),
    );

    // Every settled month went to plan except January, which overspent
    // by 300,000. A year that has only just begun has no settled month
    // at all, and the tests that need one skip.
    for (let n = 1; n < THIS_MONTH; n++) {
      await post(`${month(n)}-10`, food.id, card.id, n === 1 ? 900_000 : 600_000);
      // 급여 rises on the right — an income account on the left would be
      // the book saying the salary was paid *out*.
      await post(`${month(n)}-25`, bank.id, salary.id, 3_000_000);
    }
    // And the month we are in has something posted, which must not show.
    await post(`${month(THIS_MONTH)}-02`, food.id, card.id, 111_000);
    return section;
  }

  /**
   * The card for one 분류. Addressed by name rather than by index: the
   * sections come out in the book's own group order, which puts 비용
   * before 수익 and which the reader can reorder on /설정.
   */
  const groupSection = (page: import("@playwright/test").Page, label: string) =>
    page.locator("section").filter({ hasText: label });

  test("reads the ledger behind and the budget ahead, and says which is which", async ({
    page,
  }) => {
    test.skip(THIS_MONTH === 1, "no settled month to compare against in January");
    await seed(currentUserId);
    await page.goto(`/year?year=${YEAR}`);

    const food = page.getByTestId("year-row").filter({ hasText: "식비" });
    const cells = food.getByTestId("year-cell");

    // January is the ledger's 900,000, not the plan's 600,000.
    await expect(cells.nth(0)).toHaveAttribute("data-source", "actual");
    await expect(cells.nth(0)).toContainText("90만");
    // December is the plan, and marked as such.
    await expect(cells.nth(11)).toHaveAttribute("data-source", "budget");
    await expect(cells.nth(11)).toContainText("60만");
  });

  test("does not read the month it is in the middle of", async ({ page }) => {
    await seed(currentUserId);
    await page.goto(`/year?year=${YEAR}`);

    // 111,000 is posted this month. Showing it would read as a
    // remarkably cheap month rather than an unfinished one.
    const cells = page.getByTestId("year-row").filter({ hasText: "식비" }).getByTestId("year-cell");
    await expect(cells.nth(THIS_MONTH - 1)).toHaveAttribute("data-source", "budget");
    await expect(cells.nth(THIS_MONTH - 1)).toContainText("60만");
  });

  test("월 계획 대비 is only asked of months that are over", async ({ page }) => {
    test.skip(THIS_MONTH === 1, "no settled month to compare against in January");
    await seed(currentUserId);
    await page.goto(`/year?year=${YEAR}`);

    const rates = groupSection(page, "비용")
      .getByTestId("year-month-rate")
      .getByTestId("year-rate");
    // 900,000 spent against a 600,000 plan.
    await expect(rates.first()).toContainText("150%");
    // And nothing for the months still running on their budget, which
    // would all read 100%.
    await expect(rates).toHaveCount(THIS_MONTH - 1);
  });

  test("연 계획 대비 runs up through the year, ending where the year is headed", async ({
    page,
  }) => {
    test.skip(THIS_MONTH === 1, "no settled month to compare against in January");
    await seed(currentUserId);
    await page.goto(`/year?year=${YEAR}`);

    const rates = groupSection(page, "비용").getByTestId("year-year-rate").getByTestId("year-rate");
    // Every month has one, budget months included: the whole point is
    // saying what the year is on course for.
    await expect(rates).toHaveCount(12);
    // 900,000 of a 7,200,000 year by the end of January.
    await expect(rates.first()).toContainText("12.5%");
    // The year lands 300,000 over its 7,200,000 plan — January's
    // overspend, with every other month on plan behind and ahead.
    await expect(rates.nth(11)).toContainText("104.2%");
  });

  test("저축가능액 is 수입 − 지출, and runs up from January", async ({ page }) => {
    test.skip(THIS_MONTH === 1, "no settled month to compare against in January");
    await seed(currentUserId);
    await page.goto(`/year?year=${YEAR}`);

    const saving = page.getByTestId("year-saving").getByTestId("year-cell");
    // 3,000,000 in and 900,000 out in January.
    await expect(saving.nth(0)).toContainText("210만");
    // A planned month is 3,000,000 − 600,000.
    await expect(saving.nth(11)).toContainText("240만");

    const running = page.getByTestId("year-cumulative").locator("td");
    await expect(running.nth(0)).toContainText("210만");
    await expect(running.nth(1)).toContainText("450만");
  });

  test("steps a year at a time, and shows an untouched year as empty", async ({ page }) => {
    await seed(currentUserId);
    await page.goto(`/year?year=${YEAR}`);

    await page.getByRole("link", { name: "이전 해" }).click();
    await expect(page).toHaveURL(new RegExp(`year=${Number(YEAR) - 1}`));
    await expect(page.getByTestId("year-row")).toHaveCount(0);
  });

  test("the twelve columns scroll sideways rather than clipping", async ({ page }) => {
    await seed(currentUserId);
    await page.setViewportSize({ width: 393, height: 850 });
    await page.goto(`/year?year=${YEAR}`);

    const scroller = page.getByTestId("year-row").first().locator("xpath=ancestor::div[1]");
    const overflow = await scroller.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(overflow.scroll).toBeGreaterThan(overflow.client);
    // And the page itself does not scroll sideways with it.
    const body = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(body.scroll).toBeLessThanOrEqual(body.client);
  });
});
