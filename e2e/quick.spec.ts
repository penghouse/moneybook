import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { addMonths, today, yearMonthOf } from "../lib/date";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("quick entries", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`quick-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
    ]);
  });

  async function seedHistory(userId: string) {
    const section = await getOrCreateSection(db, { userId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const phone = await byName("통신비");
    const bank = await byName("은행");
    const food = await byName("식비");
    const card = await byName("신용카드");

    const post = async (
      date: string,
      title: string,
      left: string,
      right: string,
      amount: number,
    ) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title })
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

    const thisMonth = yearMonthOf(today(section.timezone));
    // Five months of the phone bill behind us, and none this month.
    for (let back = 1; back <= 5; back++) {
      await post(`${addMonths(thisMonth, -back)}-25`, "통신비", phone.id, bank.id, 55_000);
    }
    // Lunches: frequent, but only over two months — not a standing bill.
    for (const back of [0, 1]) {
      for (const day of ["05", "12", "19"]) {
        await post(`${addMonths(thisMonth, -back)}-${day}`, "점심", food.id, card.id, 9_000);
      }
    }
    return { section, thisMonth };
  }

  test("a standing bill offers itself, marked, and one tap fills the whole form", async ({
    page,
  }) => {
    await seedHistory(currentUserId);
    await page.goto("/");

    const before = await page.locator("main li").count();
    const chips = page.getByTestId("quick-entry");
    const bill = chips.filter({ hasText: "통신비" });
    const lunch = chips.filter({ hasText: "점심" });

    // What is missing comes first and says so; what is merely frequent
    // sits beside it saying nothing.
    await expect(chips.first()).toContainText("통신비");
    await expect(bill).toHaveAttribute("data-due", "true");
    await expect(bill).toContainText("이번 달 아직");
    await expect(lunch).not.toHaveAttribute("data-due", "true");

    // One tap fills the accounts *and* the amount — for a bill the
    // figure is the part that repeats, which is the opposite of a lunch.
    await bill.click();
    const form = page.locator("main form").first();
    await expect(form.locator('input[name="title"]')).toHaveValue("통신비");
    await expect(form.locator('input[type="number"]').first()).toHaveValue("55000");
    const pickers = form.locator('input[placeholder="계정 검색"]');
    await expect(pickers.nth(0)).toHaveValue("통신비");
    await expect(pickers.nth(1)).toHaveValue("은행");

    // Nothing was posted on its own: the form is filled in and waiting,
    // and the ledger has not grown a row behind the reader's back.
    await expect(form.getByRole("button", { name: "저장" })).toBeEnabled();
    await expect(page.locator("main li")).toHaveCount(before);
  });

  test("the mark comes off once this month has one", async ({ page }) => {
    await seedHistory(currentUserId);
    await page.goto("/");

    const before = await page.locator("main li").count();
    await page.getByTestId("quick-entry").filter({ hasText: "통신비" }).click();
    await page.locator("main form").first().getByRole("button", { name: "저장" }).click();
    await expect(page.locator("main li")).toHaveCount(before + 1);

    // Still offered — it is a repeat either way — but no longer owed.
    const bill = page.getByTestId("quick-entry").filter({ hasText: "통신비" });
    await expect(bill).toBeVisible();
    await expect(bill).not.toHaveAttribute("data-due", "true");
    await expect(bill).not.toContainText("이번 달 아직");
  });
});
