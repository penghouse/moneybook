import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { today } from "../lib/date";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("formulas", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`formulas-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
    ]);
  });

  /** A row of the term picker, addressed by the item it names. */
  const item = (page: import("@playwright/test").Page, name: string) =>
    page.getByTestId("formula-item").filter({ has: page.getByText(name, { exact: true }) });

  test("a formula built from 상위 그룹 lands at the foot of the balance sheet", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const card = await byName("신용카드");
    const opening = await byName("기초자본");
    const asOf = today(section.timezone);

    // 은행 under a 상위 그룹, so the formula has one to name.
    await db.update(accounts).set({ category: "유동성자금" }).where(eq(accounts.id, bank.id));

    const post = async (date: string, title: string, left: string, right: string, n: number) => {
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
          amount: n,
          rate: 1,
          baseAmount: n,
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: right,
          currency: "KRW",
          amount: n,
          rate: 1,
          baseAmount: n,
        },
      ]);
    };
    await post(asOf, "기초", bank.id, opening.id, 10_000_000);
    // A card balance to subtract: 은행 10,000,000 − 신용카드 2,000,000.
    await post(asOf, "카드값", opening.id, card.id, 2_000_000);

    // Reached the way the reader reaches it: the band at the foot of
    // the report, then 추가 on the page it opens.
    await page.goto("/assets");
    await page.getByRole("link", { name: "계산식 추가" }).click();
    await expect(page).toHaveURL(/\/formulas\?scope=assets$/);
    await page.getByRole("link", { name: "계산식 추가" }).click();
    await expect(page).toHaveURL(/new=1/);

    await page.getByLabel("계산식 이름").fill("쓸 수 있는 돈");
    await item(page, "유동성자금")
      .getByRole("radio", { name: /더하기/ })
      .check();
    await item(page, "신용카드").getByRole("radio", { name: /빼기/ }).check();
    await page.getByRole("button", { name: "저장" }).click();

    // Back on the list, with its value worked out.
    await expect(page.getByText("쓸 수 있는 돈")).toBeVisible();

    await page.goto("/assets");
    const row = page.getByTestId("formula-result").filter({ hasText: "쓸 수 있는 돈" });
    await expect(row).toContainText("₩8,000,000");
  });

  test("the expression turns the sum into the number actually wanted", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const opening = await byName("기초자본");

    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: today(section.timezone), title: "기초" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: bank.id,
        currency: "KRW",
        amount: 100_000_000,
        rate: 1,
        baseAmount: 100_000_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: opening.id,
        currency: "KRW",
        amount: 100_000_000,
        rate: 1,
        baseAmount: 100_000_000,
      },
    ]);

    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("살 수 있는 집값");
    await item(page, "자산 합계")
      .getByRole("radio", { name: /더하기/ })
      .check();
    // The reader types the amounts they can see, so 3억 is 300000000 —
    // not thirty billion minor units.
    await page.getByPlaceholder("예: (x+1150000000)/2").fill("(x+300000000)/2");
    await page.getByRole("button", { name: "저장" }).click();

    await page.goto("/assets");
    const row = page.getByTestId("formula-result").filter({ hasText: "살 수 있는 집값" });
    await expect(row).toContainText("₩200,000,000");
  });

  test("a formula that cannot be worked out says so instead of printing a number", async ({
    page,
  }) => {
    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("0으로 나누기");
    await page.getByPlaceholder("예: (x+1150000000)/2").fill("x/0");
    await page.getByRole("button", { name: "저장" }).click();

    await page.goto("/assets");
    const row = page.getByTestId("formula-result").filter({ hasText: "0으로 나누기" });
    await expect(row).toContainText("0으로 나눔");

    // Something that is not arithmetic at all is saved too, rather than
    // throwing away the terms the reader picked — and is diagnosed in
    // the list, one tap from where it can be fixed.
    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("나쁜 수식");
    await page.getByPlaceholder("예: (x+1150000000)/2").fill("process.exit(1)");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/formulas\?scope=assets$/);
    await expect(page.getByText(/수식을 읽을 수 없습니다/).first()).toBeVisible();
  });

  test("the income statement keeps its own formulas, and one can be deleted", async ({ page }) => {
    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("자산쪽 계산식");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/formulas\?scope=assets$/);

    // The other report's list does not carry it: a term means a balance
    // on one screen and a period's flow on the other. Scoped to the
    // switch, since the nav has a 기간손익 link of its own.
    await page.getByTestId("formula-scope").getByRole("link", { name: "기간손익" }).click();
    await expect(page).toHaveURL(/scope=income/);
    await expect(page.getByText("자산쪽 계산식")).toHaveCount(0);

    await page.getByRole("link", { name: "계산식 추가" }).click();
    await expect(page).toHaveURL(/new=1/);
    await page.getByLabel("계산식 이름").fill("손익쪽 계산식");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("손익쪽 계산식")).toBeVisible();

    await page.goto("/income");
    await expect(page.getByTestId("formula-result")).toContainText("손익쪽 계산식");
    await expect(page.getByTestId("formula-result")).not.toContainText("자산쪽");

    // Deleting takes it off the report it was on.
    await page.goto("/formulas?scope=income");
    await page.getByRole("link", { name: "손익쪽 계산식" }).click();
    await page.getByRole("button", { name: "삭제" }).click();
    await expect(page.getByText("아직 계산식이 없습니다.")).toBeVisible();

    await page.goto("/income");
    await expect(page.getByTestId("formula-result")).toHaveCount(0);
  });

  test("an item the book no longer has drops out, and the rest still adds up", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const [scratch] = await db
      .insert(accounts)
      .values({
        sectionId: section.id,
        group: "asset",
        name: "임시계정",
        currency: "KRW",
        sortOrder: 500,
      })
      .returning();
    const bank = (await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "은행")),
    }))!;
    const opening = (await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "기초자본")),
    }))!;

    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: today(section.timezone), title: "기초" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: bank.id,
        currency: "KRW",
        amount: 5_000_000,
        rate: 1,
        baseAmount: 5_000_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: opening.id,
        currency: "KRW",
        amount: 5_000_000,
        rate: 1,
        baseAmount: 5_000_000,
      },
    ]);

    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("둘 더하기");
    await item(page, "은행")
      .getByRole("radio", { name: /더하기/ })
      .check();
    await item(page, "임시계정")
      .getByRole("radio", { name: /더하기/ })
      .check();
    await page.getByRole("button", { name: "저장" }).click();

    await db.delete(accounts).where(eq(accounts.id, scratch.id));

    await page.goto("/assets");
    const row = page.getByTestId("formula-result").filter({ hasText: "둘 더하기" });
    await expect(row).toContainText("₩5,000,000");
    await expect(row).toContainText("없어진 항목 1개");
  });
});
