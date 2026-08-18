import { test, expect, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, exchangeRates, sections } from "../db/schema";
import { today } from "../lib/date";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

test.describe("entry", () => {
  // sections.id is a UUID, so "the last-created section" isn't
  // recoverable by sorting id — tests that need their own section back
  // read this instead of guessing.
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`entry-${testInfo.testId}@example.com`);
    currentUserId = seeded.userId;
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: seeded.token,
        url: "http://localhost:3000",
      },
    ]);
  });

  // The layout's header renders two forms of its own (locale toggle,
  // logout) before <main>, so a bare page.locator("form").first() grabs
  // one of those instead — scope to <main>, where the create form is
  // first (before the transaction list's filter form and any edit
  // forms), to actually land on the entry form.
  function createForm(page: Page): Locator {
    return page.locator("main form").first();
  }

  async function pickAccount(scope: Locator, inputIndex: number, name: string) {
    const inputs = scope.locator('input[placeholder="계정 검색"]');
    await inputs.nth(inputIndex).click();
    await inputs.nth(inputIndex).fill(name);
    await scope.getByRole("button", { name }).first().click();
  }

  test("each picker's tag says what the leg does to that account", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    const tag = (i: number) => form.locator("[data-tag]").nth(i);

    // By side alone the right-hand box always read 「−」. Two things were
    // wrong with that, and they are the same thing: the box was
    // describing its own position rather than what the leg does.
    await pickAccount(form, 0, "은행");
    await pickAccount(form, 1, "이자수익");
    // Money in: the bank balance rises.
    await expect(tag(0)).toHaveAttribute("data-tag", "+");
    // 수익 only ever runs one way, so no sign — green says which it is.
    await expect(tag(1)).toHaveAttribute("data-tag", "none");
    await expect(tag(1)).toHaveClass(/bg-positive/);

    // A card charge *raises* what is owed, so the right-hand box is a
    // plus here — the credit-normal rule the reports are built on.
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await expect(tag(1)).toHaveAttribute("data-tag", "+");
    // 비용 gets the same treatment as 수익, the other way round —
    // orange, not the P&L red, because against the income green red is
    // the pair red-green colour blindness cannot separate (ΔE 1.7 in
    // dark mode, where the two would be the same swatch).
    await expect(tag(0)).toHaveAttribute("data-tag", "none");
    await expect(tag(0)).toHaveClass(/bg-series-2/);

    // Paying the card down lowers the debt, so now it is a minus.
    await pickAccount(form, 0, "신용카드");
    await pickAccount(form, 1, "은행");
    await expect(tag(0)).toHaveAttribute("data-tag", "−");
    await expect(tag(1)).toHaveAttribute("data-tag", "−");
  });

  test("an account that is gone is said so, not served as a server error", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("12000");

    // The form holds ids chosen when the page rendered. An account
    // deleted in another tab — or a leg whose id no longer resolves for
    // any other reason — arrives at the action as a stranger.
    await form
      .locator('input[name="accountId"]')
      .first()
      .evaluate((el: HTMLInputElement) => {
        el.value = "00000000-0000-0000-0000-000000000000";
      });

    await form.getByRole("button", { name: "저장" }).click();

    // It used to throw, which put the whole screen behind "A server
    // error occurred" — no mention of the account, and the entry gone.
    await expect(page.getByText("없는 계정입니다.", { exact: false })).toBeVisible();
    await expect(page.getByText("서버 오류")).toHaveCount(0);
    await expect(page.getByText("A server error occurred")).toHaveCount(0);
    // And the form is usable again rather than stuck on 저장 중….
    await expect(form.getByRole("button", { name: "저장" })).toBeVisible();
  });

  test("creates a simple same-currency transaction and shows it in the list", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);

    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("12000");
    await form.locator('input[name="title"]').fill("점심");
    await form.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("점심")).toBeVisible();
    await expect(page.getByText(/식비.*12,000/)).toBeVisible();
    await expect(page.getByText(/신용카드.*12,000/)).toBeVisible();
  });

  test("clears what belongs to the transaction but keeps the date (rapid entry)", async ({
    page,
  }) => {
    await page.goto("/");
    const form = createForm(page);
    const dateInput = form.locator('input[type="date"]').first();
    const dateBefore = await dateInput.inputValue();

    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("5000");
    await form.locator('input[name="title"]').fill("커피");
    await form.locator("summary", { hasText: "메모" }).click();
    await form.locator('input[name="memo"]').fill("테이크아웃");
    await form.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("커피")).toBeVisible();
    // The date and both accounts carry over — that is what makes a run of
    // entries quick.
    await expect(dateInput).toHaveValue(dateBefore);
    await expect(form.locator('input[placeholder="계정 검색"]').first()).toHaveValue("식비");
    // Everything describing *that* transaction goes. A memo left behind
    // attaches itself to the next one without saying so.
    await expect(form.locator('input[name="title"]')).toHaveValue("");
    await expect(form.locator('input[type="number"]').first()).toHaveValue("");
    await expect(form.locator('input[name="memo"]')).toHaveValue("");
  });

  test("rejects a split transaction until debit and credit totals match", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await form.getByRole("button", { name: "분할" }).click();

    // The split view is a T-account: left legs live in the left column,
    // right legs in the right one. Addressing the columns directly is
    // both what the design promises and what makes this test stable —
    // leg indices used to depend on the order lines were added in.
    const leftColumn = form.getByTestId("entry-column-left");
    const rightColumn = form.getByTestId("entry-column-right");

    await pickAccount(leftColumn, 0, "식비");
    await leftColumn.locator('input[name="amount"]').nth(0).fill("30000");
    await leftColumn.getByRole("button", { name: /줄 추가/ }).click();
    await pickAccount(leftColumn, 1, "생활용품");
    await leftColumn.locator('input[name="amount"]').nth(1).fill("15000");

    await expect(leftColumn.getByTestId("entry-leg")).toHaveCount(2);
    await expect(rightColumn.getByTestId("entry-leg")).toHaveCount(1);

    await pickAccount(rightColumn, 0, "신용카드");
    await rightColumn.locator('input[name="amount"]').nth(0).fill("40000"); // wrong on purpose

    const saveButton = form.getByRole("button", { name: "저장" });
    await expect(saveButton).toBeDisabled();
    await expect(form.getByText(/불일치/)).toBeVisible();

    await rightColumn.locator('input[name="amount"]').nth(0).fill("45000"); // now correct
    await expect(form.getByText(/일치/)).toBeVisible();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Every account on the row is named and pressable — on a split the
    // one you want is as likely to be the second as the first.
    const row = page.locator("main li").first();
    await expect(row.getByRole("link", { name: "식비" })).toBeVisible();
    await expect(row.getByRole("link", { name: "생활용품" })).toBeVisible();
    // One link per account, not per line — a split that puts two lines on
    // the same account must not name it twice.
    await expect(row.getByRole("link", { name: "신용카드" })).toHaveCount(1);
    // The row is the button that opens its dialog; assert on that rather
    // than the list item, whose dialog is in the DOM too.
    const summary = row.locator("button").first();
    // Exact: the balance column beneath now reads "-₩45,000" (net worth
    // is negative with only a card debt on the books), which a substring
    // match would also hit.
    await expect(summary.getByText("₩45,000", { exact: true })).toBeVisible();
  });

  test("a cross-currency line auto-fills the rate from a cached exchange rate and computes the base total", async ({
    page,
  }) => {
    // beforeEach only seeds the auth user/session; the section itself is
    // created lazily by the app on first request, so ensure it exists
    // before seeding data into it.
    const section = await getOrCreateSection(db, {
      userId: currentUserId,
      locale: "ko",
    });

    await db.insert(accounts).values({
      sectionId: section.id,
      group: "asset",
      name: "달러예금",
      currency: "USD",
      sortOrder: 100,
    });
    // Pre-seed the rate so this doesn't depend on reaching frankfurter.app
    // from the sandbox (its egress is blocked here). Must match the same
    // "today" the app itself computes (section timezone), not the test
    // runner's UTC date, or the entry form's live lookup misses the cache.
    // exchange_rates is global (not scoped per section), and another spec
    // (accounts.spec.ts's manual-rate test) may have already claimed
    // today's USD->KRW row — upsert instead of a bare insert.
    await db
      .insert(exchangeRates)
      .values({
        date: today(section.timezone),
        base: "USD",
        quote: "KRW",
        rate: 1300,
        source: "api",
      })
      .onConflictDoUpdate({
        target: [exchangeRates.date, exchangeRates.base, exchangeRates.quote],
        set: { rate: 1300, source: "api" },
      });
    await db.update(sections).set({ baseCurrency: "KRW" }).where(eq(sections.id, section.id));

    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "달러예금");
    // Picking a foreign-currency account should auto-switch to detailed
    // mode and pre-fill the rate from the cached exchange rate above.
    const rateInput = form.locator('input[name="rate"][type="number"]');
    await expect(rateInput).toHaveValue("1300");

    await form.locator('input[name="amount"]').nth(0).fill("100");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[name="amount"]').nth(1).fill("130000");
    await expect(form.getByText("일치")).toBeVisible();
    await form.getByRole("button", { name: "저장" }).click();

    // Scoped to the list: "달러예금" is also an <option> in the filter form.
    await expect(page.locator("main li").first().getByText("달러예금")).toBeVisible();
  });

  test("the list shows a running balance, and the caption says whose", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);

    // Two card expenses. With no assets on the books, net worth is just
    // the debt, so the running balance is easy to read off by hand.
    //
    // On two different days, deliberately. `created_at` is
    // `unixepoch()` — whole seconds — so two transactions saved on the
    // same date within the same second fall through to `id` as the
    // tiebreak, and that is a random UUID. The list and the running-sum
    // window agree either way, but *which* one is "earlier" becomes a
    // coin flip, and this test has to know. Dating them apart is what a
    // running balance is actually about anyway.
    for (const [date, title, amount] of [
      ["2026-08-04", "점심", "12000"],
      ["2026-08-05", "저녁", "20000"],
    ] as const) {
      await pickAccount(form, 0, "식비");
      await pickAccount(form, 1, "신용카드");
      await form.locator('input[name="date"]').fill(date);
      await form.locator('input[type="number"]').first().fill(amount);
      await form.locator('input[name="title"]').fill(title);
      await form.getByRole("button", { name: "저장" }).click();
      await expect(page.getByText(title)).toBeVisible();
    }

    // Newest first: 저녁 carries both expenses, 점심 only the first.
    // `.first()`: the row button, not anything inside its dialog.
    // for the memo field.
    const rowSummary = (i: number) => page.locator("main li").nth(i).locator("button").first();
    await expect(rowSummary(0)).toContainText("-₩32,000");
    await expect(rowSummary(1)).toContainText("-₩12,000");
    await expect(page.getByText("잔액 · 순자산")).toBeVisible();

    // Filtering to one account switches both the number and the caption.
    await page.getByText("검색·필터").click();
    await page.locator('select[name="accountId"]').selectOption({ label: "신용카드" });
    await page.getByRole("button", { name: "조회" }).click();

    await expect(page.getByText("잔액 · 신용카드")).toBeVisible();
    // A liability reads as money owed, so the same history is positive here.
    await expect(rowSummary(0)).toContainText("₩32,000");
  });

  test("editing a transaction updates it in place", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("9000");
    await form.locator('input[name="title"]').fill("원래 제목");
    await form.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("원래 제목")).toBeVisible();

    await page.getByText("원래 제목").click();
    // The edit form opens as a modal rather than unfolding under the row,
    // so the whole record is on screen instead of wherever the list
    // happened to push it.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill("수정된 제목");
    await dialog.getByRole("button", { name: "저장" }).click();

    // Saving is what closes it — the dialog's work is done.
    await expect(dialog).toBeHidden();
    await expect(page.getByText("수정된 제목")).toBeVisible();
    await expect(page.getByText("원래 제목")).not.toBeVisible();
  });

  test("duplicating fills the entry form and saves a second record", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("8000");
    await form.locator('input[name="title"]').fill("정기 결제");
    await form.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("정기 결제")).toHaveCount(1);

    await page.getByText("정기 결제").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("duplicate").click();

    // Filled in without leaving the dialog. It used to navigate to
    // `/?duplicate=<id>`, which re-ran every query the page makes to
    // show values the browser was already holding.
    await expect(page).toHaveURL(/\/$/);
    const copy = dialog.locator("form").first();
    await expect(copy.locator('input[name="title"]')).toHaveValue("정기 결제");
    await expect(copy.locator('input[type="number"]').first()).toHaveValue("8000");
    const names = copy.locator('input[placeholder="계정 검색"]');
    await expect(names.nth(0)).toHaveValue("식비");
    await expect(names.nth(1)).toHaveValue("신용카드");

    // Edited before saving, and the original is untouched.
    await copy.locator('input[name="title"]').fill("정기 결제 2회차");
    await copy.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("정기 결제 2회차")).toBeVisible();
    await expect(page.getByText("정기 결제", { exact: true })).toHaveCount(1);

    // The dialog closes on save, so 저장 cannot be pressed a second time
    // to file a third copy, and the entry form below is still blank.
    await expect(dialog).toBeHidden();
    await expect(createForm(page).locator('input[name="title"]')).toHaveValue("");
  });

  test("the save button stays off until something in the transaction changes", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("9000");
    await form.locator('input[name="title"]').fill("원래 제목");
    await form.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("원래 제목")).toBeVisible();

    await page.getByText("원래 제목").click();
    const row = page.getByRole("dialog");
    const save = row.getByRole("button", { name: "저장" });

    // Nothing has changed yet, so there is nothing to save. Pressing it
    // would rewrite every line of the transaction for no gain, and the
    // round trip is what read as the page freezing.
    await expect(save).toBeDisabled();

    await row.locator('input[name="title"]').fill("수정된 제목");
    await expect(save).toBeEnabled();

    // Typed back to what it was: off again, so the button tracks the
    // content rather than merely whether a key was pressed.
    await row.locator('input[name="title"]').fill("원래 제목");
    await expect(save).toBeDisabled();
  });

  test("a copy can be saved unchanged, even though nothing differs", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("4000");
    await form.locator('input[name="title"]').fill("같은 거래");
    await form.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("같은 거래")).toHaveCount(1);

    await page.getByText("같은 거래").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("duplicate").click();

    // A duplicate is prefilled identical on purpose — the dirty check
    // belongs to editing in place, not to this.
    const copy = dialog.locator("form").first();
    await expect(copy.getByRole("button", { name: "저장" })).toBeEnabled();
    await copy.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("같은 거래")).toHaveCount(2);
  });

  test("the list shows what was written on a transaction", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("6000");
    await form.locator('input[name="title"]').fill("김밥");
    await form.locator("summary", { hasText: "메모" }).click();
    await form.locator('input[name="memo"]').fill("출근길에");
    await form.getByRole("button", { name: "저장" }).click();

    // The memo used to be visible only by opening the row, which makes a
    // list you have to open to trust.
    const row = page.locator("main li").filter({ hasText: "김밥" }).first();
    await expect(row.getByText("출근길에")).toBeVisible();
  });

  test("a #tag in a memo collects its transactions and totals them", async ({ page }) => {
    const spend = async (title: string, amount: string, memo: string) => {
      const form = createForm(page);
      await pickAccount(form, 0, "식비");
      await pickAccount(form, 1, "신용카드");
      await form.locator('input[type="number"]').first().fill(amount);
      await form.locator('input[name="title"]').fill(title);
      if (!(await form.locator('input[name="memo"]').isVisible())) {
        await form.locator("summary", { hasText: "메모" }).click();
      }
      await form.locator('input[name="memo"]').fill(memo);
      await form.getByRole("button", { name: "저장" }).click();
      await expect(page.getByText(title)).toBeVisible();
    };

    await page.goto("/");
    await spend("택시", "18000", "급해서 #낭비");
    await spend("장보기", "42000", "#필수");
    await spend("배달", "22000", "#낭비 야식");
    // Not the same tag, and a substring match would wrongly count it.
    await spend("충동구매", "99000", "#낭비벽 고쳐야");

    // Reached the way it is meant to be: the chip in the filter panel.
    await page.locator("main details", { hasText: "검색·필터" }).locator("summary").click();
    // The chip row under the filter, not the ones now inside each memo —
    // both go to the same place, but only one of them is "the filter".
    await page.locator("main details").getByRole("link", { name: "#낭비", exact: true }).click();

    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByText("2건")).toBeVisible();
    // 18,000 + 22,000 — 낭비벽 is a different tag, 필수 is not this one.
    // Exact: the running-balance column happens to read -₩40,000 here.
    await expect(page.getByText("₩40,000", { exact: true })).toBeVisible();

    const rows = page.locator("main li");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "충동구매" })).toHaveCount(0);
  });

  test("a recent 적요 suggests itself and fills in both sides", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);

    // Establish the repeat: 점심 out of 식비, onto 신용카드. The bracket
    // is the part that differs between two of the same thing, so the
    // suggestion should come back without it.
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("11000");
    await form.locator('input[name="title"]').fill("점심 (회사 앞)");
    await form.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("점심 (회사 앞)")).toBeVisible();

    // A fresh form: type the amount first, then reach for the 적요.
    await page.reload();
    const next = createForm(page);
    await next.locator('input[type="number"]').first().fill("13000");
    await next.locator('input[name="title"]').click();
    await next.locator('input[name="title"]').fill("점");

    // Offered as the bare item name, not as the one past occasion.
    const suggestion = next.getByRole("button", { name: /^점심 식비/ });
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    // Both sides come back from last time; the amount is the one part
    // that differs between repeats, so it is left alone.
    const names = next.locator('input[placeholder="계정 검색"]');
    await expect(next.locator('input[name="title"]')).toHaveValue("점심");
    await expect(names.nth(0)).toHaveValue("식비");
    await expect(names.nth(1)).toHaveValue("신용카드");
    await expect(next.locator('input[type="number"]').first()).toHaveValue("13000");

    await next.getByRole("button", { name: "저장" }).click();
    await expect(page.locator("main li").filter({ hasText: "점심" })).toHaveCount(2);
    // The stored 적요 keeps whatever was typed; only the suggestion is bare.
    await expect(page.getByText("점심 (회사 앞)")).toBeVisible();
  });

  test("deleting a transaction removes it from the list", async ({ page }) => {
    await page.goto("/");
    const form = createForm(page);
    await pickAccount(form, 0, "식비");
    await pickAccount(form, 1, "신용카드");
    await form.locator('input[type="number"]').first().fill("7000");
    await form.locator('input[name="title"]').fill("지울 거래");
    await form.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("지울 거래")).toBeVisible();

    await page.getByText("지울 거래").click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제" }).click();

    // Asserted on the row count: while the dialog is closing, its title
    // and the row both carry the text, and "not visible" cannot say
    // anything useful about two elements at once.
    await expect(page.locator("main li")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
