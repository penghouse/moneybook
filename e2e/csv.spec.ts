import { test, expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, budgets, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

// The import forms are structurally identical, so each carries a
// data-testid. They used to be addressed by position, which broke the
// moment they were reordered or wrapped.
type ImportForm = "accounts" | "transactions" | "budgets" | "rates" | "paired";

async function upload(page: Page, which: ImportForm, name: string, csv: string) {
  // Each import is collapsed into a single row until opened, so the file
  // input is not interactable before this.
  const panel = page.getByTestId(`csv-import-${which}`);
  await panel.locator("summary").click();

  const form = panel.locator("form");
  await form.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await form.getByRole("button", { name: "미리보기" }).click();
  return form;
}

test.describe("csv", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`csv-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: seeded.token,
        url: "http://localhost:3000",
      },
    ]);
  });

  test("exporting accounts CSV includes the seeded default chart of accounts", async ({ page }) => {
    await page.goto("/accounts"); // lazily creates the section + default accounts

    const response = await page.request.get("/api/csv/accounts");
    expect(response.status()).toBe(200);
    const text = (await response.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")[0]).toBe("group,name,currency,activeFrom,activeTo,memo,category");
    expect(text).toContain("expense,식비,KRW,,,,");
    expect(text).toContain("liability,신용카드,KRW,,,,");
  });

  test("exporting transactions CSV includes a seeded transaction with its line memo", async ({
    page,
  }) => {
    const section = await getOrCreateSection(db, {
      userId: currentUserId,
      locale: "ko",
    });
    const food = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "식비")),
    });
    const card = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "신용카드")),
    });
    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: "2026-07-31", title: "이마트" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: food!.id,
        currency: "KRW",
        amount: 30_000,
        rate: 1,
        baseAmount: 30_000,
        memo: "3층 델리",
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: card!.id,
        currency: "KRW",
        amount: 30_000,
        rate: 1,
        baseAmount: 30_000,
      },
    ]);

    await page.goto("/");
    const response = await page.request.get("/api/csv/transactions");
    expect(response.status()).toBe(200);
    const text = (await response.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")[0]).toBe(
      "transactionKey,date,kind,title,memo,side,account,currency,amount,rate,baseAmount,lineMemo",
    );
    expect(text).toContain("2026-07-31,normal,이마트,,left,식비,KRW,30000,1,30000,3층 델리");
    expect(text).toContain("2026-07-31,normal,이마트,,right,신용카드,KRW,30000,1,30000,");
  });

  test("accounts import: preview reports new/existing, confirm creates only the new account", async ({
    page,
  }) => {
    await page.goto("/settings");

    const form = await upload(
      page,
      "accounts",
      "accounts.csv",
      "group,name,currency,activeFrom,activeTo,memo,category\n" +
        "expense,식비,KRW,,,,\n" + // already exists (default seed) -> existing
        "expense,반려동물,KRW,2024-01-01,,새 계정,돌보는 것\n", // new, with a start date
    );

    await expect(form.getByText(/신규 1 · 기존 1 · 오류 0/)).toBeVisible();

    await form.getByRole("button", { name: "가져오기 확정" }).click();
    await expect(form.getByText(/생성됨 1 · 건너뜀 1/)).toBeVisible();

    await page.goto("/accounts");
    await expect(page.getByText("반려동물")).toBeVisible();
    // The category came in with it — a backup that dropped it would
    // restore the accounts but lose how they were filed.
    await expect(page.getByRole("heading", { name: "돌보는 것" })).toBeVisible();
  });

  test("transactions import: invalid groups are reported in Korean and skipped", async ({
    page,
  }) => {
    await page.goto("/settings");

    const form = await upload(
      page,
      "transactions",
      "transactions.csv",
      "transactionKey,date,kind,title,memo,side,account,currency,amount,rate,baseAmount,lineMemo\n" +
        "T0001,2026-07-31,normal,이마트,,left,식비,KRW,30000,1,30000,델리\n" +
        "T0001,2026-07-31,normal,이마트,,right,신용카드,KRW,30000,1,30000,\n" +
        "T0002,2026-07-31,normal,오류거래,,left,존재하지않는계정,KRW,10000,1,10000,\n" +
        "T0002,2026-07-31,normal,오류거래,,right,신용카드,KRW,10000,1,10000,\n",
    );

    await expect(form.getByText(/전체 2 · 가져올 거래 1 · 오류 1/)).toBeVisible();
    // Localized, not the raw internal message.
    await expect(form.getByText("없는 계정입니다: 존재하지않는계정")).toBeVisible();

    await form.getByRole("button", { name: "가져오기 확정" }).click();
    await expect(form.getByText(/생성됨 1 · 건너뜀 1/)).toBeVisible();

    await page.goto("/");
    const row = page.locator("main li").filter({ hasText: "이마트" });
    await expect(row).toHaveCount(1);
    // The list summarises a transaction in one line, so the imported line
    // memo is checked where it is actually carried: that row's edit form.
    await row.locator("summary").first().click();
    await expect(row.locator('input[name="lineMemo"]').first()).toHaveValue("델리");
  });

  test("a headerless file is rejected instead of silently losing its first row", async ({
    page,
  }) => {
    await page.goto("/settings");

    const form = await upload(
      page,
      "accounts",
      "accounts.csv",
      "expense,식비,KRW,,,,\nexpense,반려동물,KRW,,,,\n",
    );

    await expect(form.getByText(/첫 줄이 헤더와 다릅니다/)).toBeVisible();
    await expect(form.getByRole("button", { name: "가져오기 확정" })).toHaveCount(0);
  });

  test("budgets round-trip through export and import", async ({ page }) => {
    const section = await getOrCreateSection(db, {
      userId: currentUserId,
      locale: "ko",
    });
    const food = await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "식비")),
    });
    await db.insert(budgets).values({
      sectionId: section.id,
      accountId: food!.id,
      yearMonth: "2026-07",
      amount: 300_000,
    });

    await page.goto("/settings");
    const response = await page.request.get("/api/csv/budgets");
    const text = (await response.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")[0]).toBe("account,yearMonth,amount");
    expect(text).toContain("식비,2026-07,300000");

    // Re-import the same file with a changed amount; it should upsert.
    const form = await upload(
      page,
      "budgets",
      "budgets.csv",
      "account,yearMonth,amount\n식비,2026-07,450000\n",
    );
    await expect(form.getByText(/가져올 거래 1 · 오류 0/)).toBeVisible();
    await form.getByRole("button", { name: "가져오기 확정" }).click();
    await expect(form.getByText(/갱신 1/)).toBeVisible();

    const updated = await db.query.budgets.findFirst({
      where: and(eq(budgets.sectionId, section.id), eq(budgets.yearMonth, "2026-07")),
    });
    expect(updated?.amount).toBe(450_000);
  });

  test("paired-row import: creates the accounts it names and flips a negative row's sides", async ({
    page,
  }) => {
    await page.goto("/settings");

    const form = await upload(
      page,
      "paired",
      "paired.csv",
      "날짜,아이템,금액,기간내합계,왼쪽,,오른쪽,,메모\n" +
        "2026-08-03,이자,333333,1000000,자산,예금,수익,금융수익,\n" +
        "2026-08-02,포인트적립,-27296,700000,비용,잡비,자산,포인트,적립분\n" +
        '2026-08-01,공과금,120000,600000,비용,"수도,전기",자산,입출금통장,\n' +
        // The one row a real 8,719-row export could not be read from.
        "--&g-t;- 어,,,,,,,,\n",
    );

    await expect(form.getByText(/전체 4 · 새 계정 6 · 가져올 거래 3 · 건너뜀 1/)).toBeVisible();
    // Numbered as the file numbers it — header is line 1, so the fourth
    // data row is line 5. An error that points at the wrong line is
    // worse than no line at all when the file has 8,719 of them.
    await expect(form.getByText(/5행: 날짜 형식이 잘못되었습니다/)).toBeVisible();

    await form.getByRole("button", { name: "가져오기 확정" }).click();
    await expect(form.getByText(/생성됨 3 · 새 계정 6 · 건너뜀 1/)).toBeVisible();

    const section = await getOrCreateSection(db, { userId: currentUserId, locale: "ko" });
    const named = await db.query.accounts.findMany({
      where: eq(accounts.sectionId, section.id),
    });
    const nameById = new Map(named.map((a) => [a.id, a.name]));
    // The comma inside the account name survived the round trip; had
    // quoting been mishandled it would have split into two columns and
    // taken the whole row's alignment with it.
    expect(named.map((a) => a.name)).toContain("수도,전기");
    expect(named.find((a) => a.name === "금융수익")?.group).toBe("income");

    const flipped = await db.query.transactions.findFirst({
      where: and(eq(transactions.sectionId, section.id), eq(transactions.title, "포인트적립")),
    });
    const lines = await db.query.transactionLines.findMany({
      where: eq(transactionLines.transactionId, flipped!.id),
    });
    // Written in the file as 비용/잡비 ← 자산/포인트 for -27296.
    // Stored the only way this app can say that: the two sides
    // exchanged, the amount positive.
    expect(
      lines.map((l) => ({ side: l.side, name: nameById.get(l.accountId), amount: l.amount })),
    ).toEqual(
      expect.arrayContaining([
        { side: "left", name: "포인트", amount: 27_296 },
        { side: "right", name: "잡비", amount: 27_296 },
      ]),
    );
  });

  test("paired-row import: a name already filed under another group is reported once", async ({
    page,
  }) => {
    await page.goto("/settings"); // seeds the default chart of accounts

    const form = await upload(
      page,
      "paired",
      "paired.csv",
      "날짜,아이템,금액,기간내합계,왼쪽,,오른쪽,,메모\n" +
        // 식비 is seeded as an expense account; the file calls it an asset.
        "2026-08-01,a,1000,0,자산,식비,자산,현금,\n" +
        "2026-08-02,b,2000,0,자산,식비,자산,현금,\n",
    );

    await expect(form.getByText(/전체 2 · 새 계정 0 · 가져올 거래 0 · 건너뜀 2/)).toBeVisible();
    // Once, against the account — not twice, against each row.
    await expect(form.getByText("식비은(는) 이미 다른 분류(비용)로 있습니다")).toHaveCount(1);
    await expect(form.getByRole("button", { name: "가져오기 확정" })).toHaveCount(0);
  });

  test("exchange rates round-trip through export and import", async ({ page }) => {
    await page.goto("/settings");

    const form = await upload(
      page,
      "rates",
      "rates.csv",
      "date,base,quote,rate,source\n2026-07-31,USD,KRW,1380,manual\n",
    );
    await expect(form.getByText(/가져올 거래 1 · 오류 0/)).toBeVisible();
    await form.getByRole("button", { name: "가져오기 확정" }).click();
    await expect(form.getByText(/갱신 1/)).toBeVisible();

    const response = await page.request.get("/api/csv/rates");
    const text = (await response.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")[0]).toBe("date,base,quote,rate,source");
    expect(text).toContain("2026-07-31,USD,KRW,1380,manual");
  });
});
