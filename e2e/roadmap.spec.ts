import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { addMonths, today, yearMonthOf, yearOf } from "../lib/date";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

/** A download's bytes, without leaving a file behind. */
async function readAll(download: import("@playwright/test").Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

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
    await page.getByLabel("기본 목표수익률 (%)").fill(values.rate);
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
    await dialog.getByLabel("메모").fill("이사");
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

  test("연저축액 comes from the months — the ledger behind, the budget ahead", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const salary = await byName("급여");
    const food = await byName("식비");

    const now = today(section.timezone);
    const thisYear = yearOf(now);
    const thisMonth = yearMonthOf(now);
    const post = async (date: string, left: string, right: string, amount: number) => {
      const [tx] = await db
        .insert(transactions)
        .values({ sectionId: section.id, date, title: "월" })
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
        },
        {
          transactionId: tx.id,
          side: "right",
          accountId: right,
          currency: "KRW",
          amount,
          rate: 1,
          baseAmount: amount,
        },
      ]);
    };

    // One month that has already happened: earned 3,000,000, spent
    // 1,000,000, so 2,000,000 stayed.
    const lastMonth = addMonths(thisMonth, -1);
    await post(`${lastMonth}-15`, bank.id, salary.id, 3_000_000);
    await post(`${lastMonth}-20`, food.id, bank.id, 1_000_000);

    // And this month, which has not finished, planned instead.
    await page.goto(`/budget?period=${thisMonth}`);
    const row = (name: string) => page.getByTestId("budget-row").filter({ hasText: name });
    await row("급여").locator('input[name="amount"]').fill("4000000");
    await row("급여").getByRole("button", { name: "저장" }).click();
    await expect(row("급여").locator('input[name="amount"]')).toBeHidden();
    await row("식비").locator('input[name="amount"]').fill("1500000");
    await row("식비").getByRole("button", { name: "저장" }).click();
    await expect(row("식비").locator('input[name="amount"]')).toBeHidden();

    await addVersion(page, {
      name: "산출",
      start: thisYear,
      end: thisYear,
      starting: "0",
      // A default nobody should ever see, because the months speak first.
      saved: "999999999",
      rate: "0",
    });

    // 2,000,000 from the month behind us plus 2,500,000 planned for this
    // one. Every other month of the year is blank and adds nothing.
    await expect(rowFor(page, thisYear)).toContainText("₩4,500,000");
    await expect(rowFor(page, thisYear)).not.toContainText("₩999,999,999");

    // And the twelve months it was worked out from, one row each.
    await rowFor(page, thisYear).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`year=${thisYear}`));
    await expect(page.getByTestId("roadmap-month")).toHaveCount(12);
    await expect(page.getByTestId("roadmap-month-total")).toContainText("₩4,500,000");

    const past = page.getByTestId("roadmap-month").filter({ hasText: lastMonth });
    await expect(past).toContainText("실적");
    await expect(past).toContainText("₩2,000,000");
    const current = page.getByTestId("roadmap-month").filter({ hasText: thisMonth });
    await expect(current).toContainText("예산");
    await expect(current).toContainText("₩2,500,000");
  });

  test("this year's rate is read back out of what the book actually did", async ({ page }) => {
    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const byName = async (name: string) =>
      (await db.query.accounts.findFirst({
        where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
      }))!;
    const bank = await byName("은행");
    const opening = await byName("기초자본");

    const now = today(section.timezone);
    const thisYear = yearOf(now);
    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: now, title: "기초" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: bank.id,
        currency: "KRW",
        amount: 55_000_000,
        rate: 1,
        baseAmount: 55_000_000,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: opening.id,
        currency: "KRW",
        amount: 55_000_000,
        rate: 1,
        baseAmount: 55_000_000,
      },
    ]);

    await page.goto("/formulas?scope=assets&new=1");
    await page.getByLabel("계산식 이름").fill("총자산");
    await page
      .getByTestId("formula-item")
      .filter({ has: page.getByText("자산 합계", { exact: true }) })
      .getByRole("radio", { name: /더하기/ })
      .check();
    await page.getByRole("button", { name: "저장" }).click();

    // Opened at 50,000,000, nothing saved in yet, standing at
    // 55,000,000 — so the year has earned 10%, whatever the plan said.
    await addVersion(page, {
      name: "역산",
      start: thisYear,
      end: thisYear,
      starting: "50000000",
      saved: "0",
      rate: "3",
    });
    await page.getByRole("link", { name: "버전 설정" }).click();
    await page.getByLabel("실제값으로 쓸 계산식").selectOption({ label: "총자산" });
    await page.getByRole("button", { name: "저장" }).click();

    // What it earned, and the target it is being read against — two
    // columns, because the gap between them is the point.
    await expect(rowFor(page, thisYear).getByTestId("roadmap-rate")).toContainText("10%");
    await expect(rowFor(page, thisYear).getByTestId("roadmap-target-rate")).toContainText("3%");
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

  test("the table really scrolls sideways rather than clipping", async ({ page }) => {
    await addVersion(page, {
      name: "넓은 표",
      start: "2030",
      end: "2045",
      starting: "100000000",
      saved: "20000000",
      rate: "10",
    });
    await page.setViewportSize({ width: 393, height: 852 });

    const scroller = page.locator("table").locator("xpath=..");
    const state = await scroller.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      wider: el.scrollWidth > el.clientWidth,
    }));

    // `scrollWidth > clientWidth` alone proves only that the content is
    // too wide — it reports the same number when overflow is hidden and
    // the columns are simply cut off, which is how a card's own
    // overflow-hidden once silently won this argument.
    expect(state.wider).toBe(true);
    expect(["auto", "scroll"]).toContain(state.overflowX);

    // And it moves when pushed.
    await scroller.evaluate((el) => el.scrollTo({ left: 400 }));
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test("the whole roadmap saves as one phone-shaped picture, blurred on request", async ({
    page,
  }) => {
    await addVersion(page, {
      name: "사진",
      start: "2030",
      end: "2049",
      starting: "100000000",
      saved: "20000000",
      rate: "10",
    });

    // A PNG says its own size in the eight bytes after the IHDR tag, so
    // the shape can be checked without decoding the image.
    const sizeOf = (png: Buffer) => ({
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    });

    await page.getByTestId("roadmap-image").click();
    const plainDownload = page.waitForEvent("download");
    await page.getByTestId("roadmap-image-confirm").click();
    const plain = await plainDownload;
    // The name is not asserted: Chromium reports every blob download as
    // "download" over the automation protocol, whatever the anchor says.
    // Checked by hand instead — the anchor carries the right `download`
    // and is in the document when clicked.
    const plainPng = await readAll(plain);
    const size = sizeOf(plainPng);
    expect(size.width).toBe(1080);
    // Tall enough for a phone, and grown past it only by the extra years.
    expect(size.height).toBeGreaterThanOrEqual(1920);

    // Blurring changes the picture, and only the picture — same shape.
    await page.getByTestId("roadmap-image").click();
    await page.getByTestId("roadmap-image-mask").check();
    const maskedDownload = page.waitForEvent("download");
    await page.getByTestId("roadmap-image-confirm").click();
    const maskedPng = await readAll(await maskedDownload);
    expect(sizeOf(maskedPng)).toEqual(size);
    expect(maskedPng.equals(plainPng)).toBe(false);

    // Rounding is a different picture again, at the same shape.
    await page.getByTestId("roadmap-image").click();
    await page.getByTestId("roadmap-image-mask").uncheck();
    await page.getByTestId("roadmap-image-rounded").check();
    const roundDownload = page.waitForEvent("download");
    await page.getByTestId("roadmap-image-confirm").click();
    const roundPng = await readAll(await roundDownload);
    expect(sizeOf(roundPng)).toEqual(size);
    expect(roundPng.equals(plainPng)).toBe(false);
  });

  test("the picture can be turned on its side, with the years running across", async ({ page }) => {
    await addVersion(page, {
      name: "가로",
      start: "2030",
      end: "2049",
      starting: "100000000",
      saved: "20000000",
      rate: "10",
    });

    // The options are asked once, when a picture is being made, so each
    // pass opens the panel again.
    const shoot = async (set: (page: Page) => Promise<void>) => {
      await page.getByTestId("roadmap-image").click();
      await set(page);
      const download = page.waitForEvent("download");
      await page.getByTestId("roadmap-image-confirm").click();
      const png = await readAll(await download);
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };

    const exact = await shoot(async (p) => {
      await p.getByTestId("roadmap-image-shape").selectOption("wide");
    });
    expect(exact.width).toBe(1920);
    expect(exact.width).toBeGreaterThan(exact.height);

    // Short figures fit more years to a band, so the same twenty years
    // need fewer bands and the picture is shorter — the column width is
    // measured from the text, not guessed.
    const rounded = await shoot(async (p) => {
      await p.getByTestId("roadmap-image-rounded").check();
    });
    expect(rounded.width).toBe(1920);
    expect(rounded.height).toBeLessThan(exact.height);
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
