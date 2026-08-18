import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { today, yearOf } from "../lib/date";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("roadmap", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`roadmap-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
    ]);
  });

  /** The version form, filled the way a reader fills it. */
  async function addVersion(
    page: Page,
    values: {
      name: string;
      start: string;
      end: string;
      starting: string;
      saved: string;
      rate: string;
    },
  ) {
    await page.goto("/roadmap?new=1");
    await page.getByLabel("버전 이름").fill(values.name);
    await page.getByLabel("시작 연도").fill(values.start);
    await page.getByLabel("종료 연도").fill(values.end);
    await page.getByLabel("시작자산").fill(values.starting);
    await page.getByLabel("기본 연저축액").fill(values.saved);
    await page.getByLabel("기본 수익률 (%)").fill(values.rate);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/roadmap\?id=/);
  }

  const rowFor = (page: Page, year: string) =>
    page.getByTestId("roadmap-row").filter({ hasText: year });

  test("a version compounds year by year, and one year can break step", async ({ page }) => {
    await addVersion(page, {
      name: "10% 안",
      start: "2030",
      end: "2033",
      starting: "100000000",
      saved: "10000000",
      rate: "10",
    });

    // (100,000,000 + 10,000,000) × 1.1
    await expect(rowFor(page, "2030")).toContainText("₩121,000,000");
    // (121,000,000 + 10,000,000) × 1.1
    await expect(rowFor(page, "2031")).toContainText("₩144,100,000");

    // Give 2031 a saving of its own; every year after it moves.
    await rowFor(page, "2031").getByRole("button").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("연저축액").fill("50000000");
    await dialog.getByLabel("인생목표").fill("이사");
    await dialog.getByRole("button", { name: "저장" }).click();

    // (121,000,000 + 50,000,000) × 1.1
    await expect(rowFor(page, "2031")).toContainText("₩188,100,000");
    await expect(rowFor(page, "2031")).toContainText("이사");
    // 2030 is upstream of the change and must not have moved.
    await expect(rowFor(page, "2030")).toContainText("₩121,000,000");
  });

  test("the past fills itself from the ledger, at the formula's own figure", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
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
        amount: 70_000_000,
        rate: 1,
        baseAmount: 70_000_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: opening.id,
        currency: "KRW",
        amount: 70_000_000,
        rate: 1,
        baseAmount: 70_000_000,
      },
    ]);

    // A 자산 합계 formula, which is what the roadmap will read.
    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("총자산");
    await page
      .getByTestId("formula-item")
      .filter({ has: page.getByText("자산 합계", { exact: true }) })
      .getByRole("radio", { name: /더하기/ })
      .check();
    await page.getByRole("button", { name: "저장" }).click();

    const thisYear = yearOf(today(section.timezone));
    await addVersion(page, {
      name: "실적 반영",
      start: thisYear,
      end: String(Number(thisYear) + 2),
      starting: "1000000",
      saved: "0",
      rate: "0",
    });

    // Still plan-only: no formula chosen, so the standing column is the
    // plan's own arithmetic.
    await expect(rowFor(page, thisYear)).toContainText("₩1,000,000");

    await page.getByRole("link", { name: "버전 설정" }).click();
    await page.getByLabel("실제값으로 쓸 계산식").selectOption({ label: "총자산" });
    await page.getByRole("button", { name: "저장" }).click();

    // The ledger's own figure, not the plan's — and the same number the
    // balance sheet prints for that formula.
    await expect(rowFor(page, thisYear)).toContainText("₩70,000,000");
    await page.goto("/assets");
    await expect(page.getByTestId("formula-result").filter({ hasText: "총자산" })).toContainText(
      "₩70,000,000",
    );
  });

  test("versions are switched by tab, and each keeps its own figures", async ({ page }) => {
    await addVersion(page, {
      name: "보수적",
      start: "2030",
      end: "2031",
      starting: "100000000",
      saved: "0",
      rate: "3",
    });
    await addVersion(page, {
      name: "공격적",
      start: "2030",
      end: "2031",
      starting: "100000000",
      saved: "0",
      rate: "20",
    });

    await expect(rowFor(page, "2030")).toContainText("₩120,000,000");

    await page.getByTestId("roadmap-versions").getByRole("link", { name: "보수적" }).click();
    await expect(rowFor(page, "2030")).toContainText("₩103,000,000");
  });

  test("a range running backwards is refused rather than stored", async ({ page }) => {
    await page.goto("/roadmap?new=1");
    await page.getByLabel("버전 이름").fill("거꾸로");
    await page.getByLabel("시작 연도").fill("2035");
    await page.getByLabel("종료 연도").fill("2030");
    await page.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("종료 연도가 시작 연도보다 앞설 수 없습니다.")).toBeVisible();
  });
});
