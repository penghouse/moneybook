import { test, expect, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "../e2e/auth-helper";
import { caption, goto } from "./caption";

/**
 * The phone walkthrough. Deliberately not a shortened copy of the
 * desktop one — it only shows what is different at 393px: the drawer,
 * the debit/credit pair holding its two columns, and the screens that
 * used to fold or scroll sideways.
 */

function main(page: Page): Locator {
  return page.locator("main");
}

function entryForm(page: Page): Locator {
  return main(page).locator("form").first();
}

async function pickAccount(scope: Locator, index: number, name: string) {
  const inputs = scope.locator('input[placeholder="계정 검색"]');
  await inputs.nth(index).click();
  await inputs.nth(index).fill(name);
  await scope.getByRole("button", { name }).first().click();
}

test("moneybook mobile walkthrough", async ({ page, context }) => {
  const seeded = await seedSession("demo-mobile@example.com");
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
  ]);
  const section = await getOrCreateSection(db, { userId: seeded.userId, locale: "ko" });

  // Warm every route: a first-request compile landing mid-step both
  // stalls the video and can swallow the interaction that triggered it.
  for (const path of ["/", "/accounts", "/assets", "/budget"]) {
    await page.goto(path);
    await expect(main(page)).toBeVisible();
  }

  const byName = async (name: string) =>
    (await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, name)),
    }))!;
  const bank = await byName("은행");
  const equity = await byName("기초자본");
  const [opening] = await db
    .insert(transactions)
    .values({ sectionId: section.id, date: "2026-01-01", title: "기초잔액", kind: "opening" })
    .returning();
  await db.insert(transactionLines).values([
    {
      transactionId: opening.id,
      lineOrder: 0,
      side: "left",
      accountId: bank.id,
      currency: "KRW",
      amount: 5_000_000,
      rate: 1,
      baseAmount: 5_000_000,
    },
    {
      transactionId: opening.id,
      lineOrder: 1,
      side: "right",
      accountId: equity.id,
      currency: "KRW",
      amount: 5_000_000,
      rate: 1,
      baseAmount: 5_000_000,
    },
  ]);

  // ---- 1. 하단 바 + 드로어 ----
  await goto(page, "/", "① 내비는 화면 아래 — 엄지가 닿는 곳에 즐겨찾기한 메뉴가 있습니다");
  await caption(page, "① 즐겨찾기는 설정에서 최대 4개까지 고릅니다", 2000);
  await page.getByRole("button", { name: "더보기" }).click();
  const drawer = page.getByRole("dialog", { name: "메뉴" });
  await expect(drawer).toBeVisible();
  await caption(page, "① 나머지 메뉴는 「더보기」 드로어에 — 언어·테마·로그아웃도 여기", 2200);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await caption(page, "① ESC·백드롭·화면 이동 어느 쪽으로도 닫힙니다", 1600);

  // ---- 2. 한 줄 입력 ----
  await caption(page, "② 좁은 화면에서도 왼쪽은 왼쪽, 오른쪽은 오른쪽에 둡니다", 2000);
  let form = entryForm(page);
  await pickAccount(form, 0, "식비");
  await pickAccount(form, 1, "신용카드");
  await form.locator('input[type="number"]').first().fill("12000");
  await form.locator('input[name="title"]').fill("점심");
  await caption(page, "② 어느 쪽에 놓느냐가 곧 분개라, 세로로 쌓지 않았습니다", 2200);
  await form.getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText("점심")).toBeVisible();

  // ---- 3. 좌우 교환 ----
  await goto(page, "/", "③ 가운데 ⇄ 버튼으로 좌우를 통째로 바꿉니다");
  form = entryForm(page);
  await pickAccount(form, 0, "식비");
  await pickAccount(form, 1, "신용카드");
  await caption(page, "③ 방향을 잘못 골랐을 때 다시 고르지 않아도 됩니다", 1600);
  await form.getByRole("button", { name: "좌우 바꾸기" }).click();
  const accountInputs = form.locator('input[placeholder="계정 검색"]');
  await expect(accountInputs.nth(0)).toHaveValue("신용카드");
  await expect(accountInputs.nth(1)).toHaveValue("식비");
  await caption(page, "③ 두 계정이 자리를 맞바꿨습니다", 2000);

  // ---- 4. 분할 = T계정 2열 ----
  await goto(page, "/", "④ 분할 입력도 같은 2열 — 왼쪽 줄은 왼쪽 열에 쌓입니다");
  form = entryForm(page);
  await form.getByRole("button", { name: "분할" }).click();
  const leftColumn = form.getByTestId("entry-column-left");
  const rightColumn = form.getByTestId("entry-column-right");

  await pickAccount(leftColumn, 0, "식비");
  await leftColumn.locator('input[name="amount"]').nth(0).fill("30000");
  // Still named lineMemo in the form and the CSV; only the label people
  // read is 세부내역. Worth showing at 393px — it is the narrowest field
  // in the split view.
  await leftColumn.locator('input[name="lineMemo"]').nth(0).fill("장보기");
  await caption(page, "④ 줄마다 「세부내역」도 좁은 화면에서 그대로 들어갑니다", 2000);
  await leftColumn.getByRole("button", { name: /줄 추가/ }).click();
  await pickAccount(leftColumn, 1, "생활용품");
  await leftColumn.locator('input[name="amount"]').nth(1).fill("15000");
  await pickAccount(rightColumn, 0, "신용카드");
  await rightColumn.locator('input[name="amount"]').nth(0).fill("45000");
  await form.locator('input[name="title"]').fill("이마트");

  await expect(leftColumn.getByTestId("entry-leg")).toHaveCount(2);
  await expect(rightColumn.getByTestId("entry-leg")).toHaveCount(1);
  await caption(page, "④ 줄 수가 안 맞으면 짧은 쪽에 점선 빈칸이 남습니다", 2400);
  await expect(form.getByText(/일치/)).toBeVisible();
  await form.getByRole("button", { name: "저장" }).click();
  await expect(main(page).locator("li").first().getByText("식비 외 1")).toBeVisible();
  await caption(page, "④ 목록은 한 건이 두 줄 — 적요·합계, 그리고 계정 흐름", 2200);

  // ---- 5. 잔액 열 ----
  // .first(): the row's own summary, not the memo disclosure inside the
  // edit form that the same <li> also holds.
  const rowSummary = (i: number) => main(page).locator("li").nth(i).locator("summary").first();

  await caption(page, "⑤ 합계 아래 회색 숫자가 그 거래 직후의 잔액입니다", 2000);
  await expect(main(page).getByText("잔액 · 순자산")).toBeVisible();
  await expect(rowSummary(0)).toContainText("₩4,943,000");
  await expect(rowSummary(1)).toContainText("₩4,988,000");
  await caption(page, "⑤ 393px에서도 합계와 잔액이 오른쪽에 2단으로 들어갑니다", 2600);

  // ---- 6. 자산현황 ----
  await goto(page, "/assets", "⑥ 자산현황 — 순자산을 가장 큰 숫자로");
  await expect(main(page).getByText("순자산")).toBeVisible();
  await caption(page, "⑥ 금액은 전부 고정폭 숫자라 자릿수가 세로로 맞습니다", 2400);

  // ---- 7. 자산 그래프 ----
  await main(page).getByRole("link", { name: "그래프 보기" }).click();
  await caption(page, "⑦ 「그래프 보기」 — 숫자만으로는 안 보이는 것", 2000);
  await expect(main(page).getByRole("heading", { name: "순자산 추이" })).toBeVisible();
  await caption(page, "⑦ 한 그래프에 자산·부채·순자산 — 자산과 순자산 사이가 곧 부채입니다", 2400);
  await expect(main(page).getByRole("heading", { name: "자산 구성" })).toBeVisible();
  await caption(page, "⑦ 그래프를 못 읽어도 「표로 보기」로 숫자에 닿습니다", 2400);

  // ---- 8. 예산 ----
  await goto(page, "/budget", "⑧ 예산 — 계정마다 진행바로 집행률을 봅니다");
  const foodRow = main(page).getByTestId("budget-row").filter({ hasText: "식비" });
  await foodRow.locator('input[name="amount"]').fill("50000");
  await foodRow.getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText(/잔여|초과/)).toBeVisible();
  await caption(page, "⑧ 예산을 넘기면 진행바와 잔여 표시가 빨간색으로 바뀝니다", 2400);

  // ---- 9. 다크모드 ----
  await page.getByRole("button", { name: "더보기" }).click();
  await caption(page, "⑨ 테마는 드로어 아래에서 라이트 / 다크 / 시스템 중 고릅니다", 2000);
  await drawer.getByRole("button", { name: "다크" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await caption(page, "⑨ 어느 화면도 가로로 밀리지 않습니다 — 360px에서도", 2600);
});
