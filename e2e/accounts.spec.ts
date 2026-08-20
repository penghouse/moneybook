import { test, expect, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, sections, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { addDays, today } from "../lib/date";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

/** What getOrCreateSection seeds a new section with. */
const SECTION_TIMEZONE = "Asia/Seoul";

/**
 * One account's row, found by its own <summary> rather than by page text
 * — the 거래처 관리 hint names 받을돈 as an example, so prose from one
 * row can match another.
 */
function accountRow(page: Page, name: string) {
  return page.locator("main li").filter({ has: page.locator("summary").filter({ hasText: name }) });
}

/**
 * Sets a row's (or the new-account form's) 상위 그룹.
 *
 * The field is a menu of what the 분류 already has, with one option that
 * opens a box for a new one — so filing under an existing 상위 그룹 and
 * inventing one are two different gestures, and the test does whichever
 * applies.
 */
async function setCategory(scope: Locator, name: string) {
  const select = scope.locator('select[name="category"]');
  if ((await select.count()) > 0) {
    const offered = await select.locator("option").allInnerTexts();
    if (offered.includes(name)) {
      await select.selectOption({ label: name });
      return;
    }
    await select.selectOption({ label: "+ 새 상위 그룹" });
  }
  await scope.locator('input[name="category"]').fill(name);
}

/** The 상위 그룹 the field offers, without 미분류 or the "new" option. */
async function categoryOptions(scope: Locator): Promise<string[]> {
  const values = await scope
    .locator('select[name="category"] option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  // 미분류 and the "new" entry both carry an empty value, so what is
  // left is exactly the 상위 그룹 on offer.
  return values.filter((v) => v !== "");
}

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
    //
    // Computed through the app's own helpers against the section's
    // timezone, not the runner's UTC clock. Those two are the same date
    // for most of the day and a day apart after 15:00 UTC, which is a
    // test that passes all morning and fails after dinner.
    const yesterday = addDays(today(SECTION_TIMEZONE), -1);
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

  test("the group order set here is what every other screen lists them in", async ({ page }) => {
    await page.goto("/accounts");

    // Assets are listed first by default; move liabilities above them.
    await page
      .locator("section")
      .filter({ hasText: "부채" })
      .first()
      .getByRole("button", { name: "위로" })
      .first()
      .click();

    // Wait for the move to land before leaving. `click()` returns when
    // the click is dispatched, not when the server action it submitted
    // has finished — navigating away at that moment cancels the request
    // in flight, and the order never changes at all. 위로 goes disabled
    // once 부채 is first, which is the page saying it applied the move.
    await expect(
      page
        .locator("section")
        .filter({ hasText: "부채" })
        .first()
        .getByRole("button", { name: "위로" })
        .first(),
    ).toBeDisabled();

    // The balance sheet follows. Asserted on the rendered order rather
    // than on the stored value, because the stored value agreeing while
    // the page ignores it is exactly the bug this guards against.
    //
    // Polled, not read once: `allInnerTexts` takes a single snapshot with
    // no retry, and a route that is still streaming shows the loading
    // spinner and no sections at all. Read at that instant the page has
    // neither group on it, which is a red test about nothing.
    await page.goto("/assets");
    await expect
      .poll(async () => {
        const order = await page.locator("main section").allInnerTexts();
        const assetAt = order.findIndex((text) => text.startsWith("자산"));
        const liabilityAt = order.findIndex((text) => text.startsWith("부채"));
        return assetAt >= 0 && liabilityAt >= 0 ? liabilityAt < assetAt : null;
      })
      .toBe(true);
  });

  test("a category groups expense accounts and subtotals them on the income statement", async ({
    page,
  }) => {
    await page.goto("/accounts");

    // File two of the seeded expense accounts under one category.
    for (const name of ["식비", "생활용품"]) {
      const row = page.locator("li").filter({ hasText: name }).first();
      await row.locator("summary").click();
      await setCategory(row, "먹고사는 것");
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
    const band = page.getByTestId("income-category").filter({ hasText: "먹고사는 것" });
    await expect(band).toContainText("₩15,000");

    // And the band puts its rows away, keeping the subtotal on screen —
    // which is the point of folding it.
    await expect(page.getByRole("link", { name: /식비/ })).toBeVisible();
    await band.click();
    await expect(page.getByRole("link", { name: /식비/ })).toHaveCount(0);
    await expect(band).toContainText("₩15,000");

    // The fold survives an ordinary navigation, or stepping a month
    // would undo every fold the reader had made.
    await page.reload();
    const after = page.getByTestId("income-category").filter({ hasText: "먹고사는 것" });
    await expect(after).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: /식비/ })).toHaveCount(0);

    await after.click();
    await expect(page.getByRole("link", { name: /식비/ })).toBeVisible();
  });

  test("상위 그룹 suggestions are scoped to their 분류", async ({ page }) => {
    await page.goto("/accounts");

    // File an expense under 먹고사는 것.
    const food = accountRow(page, "식비");
    await food.locator("summary").click();
    await setCategory(food, "먹고사는 것");
    await food.getByRole("button", { name: "저장" }).click();
    await expect(page.getByRole("heading", { name: "먹고사는 것" }).first()).toBeVisible();

    // A 상위 그룹 groups accounts within one 분류, so an expense's
    // grouping has no business being offered on a 자산.
    //
    // Read off the <option> elements, which is the point of the field
    // being a menu rather than a text box with a suggestion popup: the
    // popup is browser UI, so a test could check the `list` attribute
    // and never what was actually on offer — and what was on offer was
    // the previous 분류's, pickable, which is how an asset account ends
    // up filed under an expense's 상위 그룹.
    const bank = accountRow(page, "은행");
    await bank.locator("summary").click();
    expect(await categoryOptions(bank)).toEqual([]);
    expect(await categoryOptions(food)).toEqual(["먹고사는 것"]);

    // The new-account form follows whichever 분류 is selected.
    const newForm = page.locator("form").filter({ has: page.getByPlaceholder("예: 식비") });
    await newForm.locator('select[name="group"]').selectOption("expense");
    expect(await categoryOptions(newForm)).toEqual(["먹고사는 것"]);
    await newForm.locator('select[name="group"]').selectOption("asset");
    expect(await categoryOptions(newForm)).toEqual([]);
  });

  test("moving an account up changes its order within the group", async ({ page }) => {
    await page.goto("/accounts");

    const expenseSection = page.locator("section").filter({ hasText: "비용" }).first();
    // Each <summary> has two spans (name, currency); :first-child is the
    // name one, so this is the ordered list of account names in the group.
    const nameSpans = expenseSection.locator("li summary span:first-child");
    const namesBefore = await nameSpans.allInnerTexts();
    expect(namesBefore).toEqual(["식비", "교통비", "통신비", "생활용품"]);

    // No <summary> click first: the arrows are on the row itself. Burying
    // them in the panel is what made ordering look unimplemented, since
    // the group-level pair was visible on the heading right above.
    const row = accountRow(page, "교통비");
    await expect(row.locator("details")).not.toHaveAttribute("open", "");
    await row.getByRole("button", { name: "위로" }).click();

    // The submit goes through a server action (fetch + revalidate +
    // re-render), which lands after the click event resolves — poll
    // instead of asserting immediately.
    await expect
      .poll(() => nameSpans.allInnerTexts())
      .toEqual(["교통비", "식비", "통신비", "생활용품"]);
  });

  test("an account moves within its 상위 그룹, past a gap another group left", async ({ page }) => {
    await page.goto("/accounts");

    // 식비 and 생활용품 filed together, 교통비 left between them in
    // sort order. This is the shape that made 위로 do nothing: 생활용품's
    // sortOrder neighbour was 교통비, in another category, so the two
    // swapped numbers and the screen came back identical.
    for (const name of ["식비", "생활용품"]) {
      const row = accountRow(page, name);
      await row.locator("summary").click();
      await setCategory(row, "먹고사는 것");
      await row.getByRole("button", { name: "저장" }).click();
      await expect(page.getByRole("heading", { name: "먹고사는 것" }).first()).toBeVisible();
    }

    const expenseSection = page.locator("section").filter({ hasText: "비용" }).first();
    const inCategory = expenseSection
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: "먹고사는 것" }) })
      .last()
      .locator("li summary span:first-child");
    await expect.poll(() => inCategory.allInnerTexts()).toEqual(["식비", "생활용품"]);

    await accountRow(page, "생활용품").getByRole("button", { name: "위로" }).click();
    await expect.poll(() => inCategory.allInnerTexts()).toEqual(["생활용품", "식비"]);
  });

  test("the ends of a 상위 그룹 cannot be moved out of it", async ({ page }) => {
    await page.goto("/accounts");
    for (const name of ["식비", "교통비"]) {
      const row = accountRow(page, name);
      await row.locator("summary").click();
      await setCategory(row, "먹고사는 것");
      await row.getByRole("button", { name: "저장" }).click();
      await expect(page.getByRole("heading", { name: "먹고사는 것" }).first()).toBeVisible();
    }

    // First of its block: 위로 is dead. Last of its block: 아래로 is dead,
    // even though 통신비 sits below it on screen in another category.
    await expect(accountRow(page, "식비").getByRole("button", { name: "위로" })).toBeDisabled();
    await expect(accountRow(page, "교통비").getByRole("button", { name: "아래로" })).toBeDisabled();
    // ...and the ends of the group below it behave the same way.
    await expect(accountRow(page, "통신비").getByRole("button", { name: "위로" })).toBeDisabled();
    await expect(
      accountRow(page, "생활용품").getByRole("button", { name: "아래로" }),
    ).toBeDisabled();
  });

  test("a 상위 그룹 moves as a whole, and 미분류 stays last", async ({ page }) => {
    await page.goto("/accounts");
    for (const [name, category] of [
      ["식비", "먹고사는 것"],
      ["교통비", "타는 것"],
    ]) {
      const row = accountRow(page, name);
      await row.locator("summary").click();
      await setCategory(row, category);
      await row.getByRole("button", { name: "저장" }).click();
      await expect(page.getByRole("heading", { name: category }).first()).toBeVisible();
    }

    const expenseSection = page.locator("section").filter({ hasText: "비용" }).first();
    // :first-child is the name; the heading also carries its arrows.
    const headings = expenseSection.locator("h3 span:first-child");
    await expect.poll(() => headings.allInnerTexts()).toEqual(["먹고사는 것", "타는 것", "미분류"]);

    // The arrows live in the heading itself, so scope to the <h3> — its
    // parent block also holds every account row's own pair.
    const block = (name: string) => expenseSection.locator("h3").filter({ hasText: name });
    await block("타는 것").getByRole("button", { name: "위로" }).click();
    await expect.poll(() => headings.allInnerTexts()).toEqual(["타는 것", "먹고사는 것", "미분류"]);

    // Its accounts came with it, and 미분류 is not somewhere a real
    // category can be pushed below.
    const names = expenseSection.locator("li summary span:first-child");
    await expect
      .poll(() => names.allInnerTexts())
      .toEqual(["교통비", "식비", "통신비", "생활용품"]);
    await expect(block("먹고사는 것").getByRole("button", { name: "아래로" })).toBeDisabled();
    await expect(block("타는 것").getByRole("button", { name: "위로" })).toBeDisabled();
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
