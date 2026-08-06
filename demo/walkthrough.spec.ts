import { test, expect, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions } from "../db/schema";
import { today } from "../lib/date";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "../e2e/auth-helper";
import { caption, goto } from "./caption";

/**
 * A recorded walkthrough of the main flows, for watching rather than
 * asserting — though it still asserts at each step, so the video can
 * never show a green run of something that silently didn't work.
 */

/** All content assertions run inside <main>, away from the caption bar. */
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

test("moneybook walkthrough", async ({ page, context }) => {
  const seeded = await seedSession("demo@example.com");
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: seeded.token, url: "http://localhost:3000" },
  ]);
  const section = await getOrCreateSection(db, { userId: seeded.userId, locale: "ko" });
  const asOf = today(section.timezone);

  // Visit every route once before recording anything meaningful. The dev
  // server compiles routes on first request, and a compile landing
  // mid-step both stalls the video and can swallow the interaction that
  // triggered it.
  for (const path of ["/", "/accounts", "/settings", "/assets", "/income", "/budget"]) {
    await page.goto(path);
    await expect(main(page)).toBeVisible();
  }

  // A starting bank balance, so the balance sheet reads like a real book
  // rather than showing the cash side of every entry as negative. This is
  // exactly what the app's own "기초" (opening) transaction kind is for.
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

  // ---- 1. 한 줄 입력 ----
  await goto(page, "/", "① 한 줄 입력 — 왼쪽(식비) / 오른쪽(신용카드)만 고르면 끝");
  let form = entryForm(page);
  await pickAccount(form, 0, "식비");
  await pickAccount(form, 1, "신용카드");
  await form.locator('input[type="number"]').first().fill("12000");
  await form.locator('input[name="title"]').fill("점심");
  await caption(page, "① 저장하면 복식부기 두 줄로 기록됩니다");
  await form.getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText("점심")).toBeVisible();
  await caption(page, "① 저장 완료 — 날짜·계정은 유지되고 금액·적요만 비워집니다", 1600);

  // ---- 2. 분할 입력 + 세부내역 ----
  await goto(page, "/", "② 분할 입력 — T계정처럼 왼쪽 줄은 왼쪽 열, 오른쪽 줄은 오른쪽 열");
  form = entryForm(page);
  await form.getByRole("button", { name: "분할" }).click();
  const leftColumn = form.getByTestId("entry-column-left");
  const rightColumn = form.getByTestId("entry-column-right");

  await pickAccount(leftColumn, 0, "식비");
  await leftColumn.locator('input[name="amount"]').nth(0).fill("30000");
  // The field is still named lineMemo in the form and the CSV — only the
  // label people read moved to 세부내역.
  await leftColumn.locator('input[name="lineMemo"]').nth(0).fill("장보기");
  await caption(page, "② 줄마다 「세부내역」을 달 수 있습니다 — 식비 30,000은 「장보기」", 2000);

  await caption(page, "② 짧은 쪽에 남는 점선 빈칸이 그대로 「줄 추가」 버튼입니다", 1800);
  await leftColumn.getByRole("button", { name: /줄 추가/ }).click();
  await pickAccount(leftColumn, 1, "생활용품");
  await leftColumn.locator('input[name="amount"]').nth(1).fill("15000");
  await leftColumn.locator('input[name="lineMemo"]').nth(1).fill("세제");

  await pickAccount(rightColumn, 0, "신용카드");
  await form.locator('input[name="title"]').fill("이마트");
  await caption(page, "② 왼쪽 2줄 · 오른쪽 1줄 — 오른쪽 열에 빈칸이 하나 남습니다", 1800);

  await rightColumn.locator('input[name="amount"]').nth(0).fill("40000");
  await caption(page, "② 양쪽 합계가 어긋나면 저장 버튼이 잠깁니다", 1800);
  await expect(form.getByText(/불일치/)).toBeVisible();
  await expect(form.getByRole("button", { name: "저장" })).toBeDisabled();

  await rightColumn.locator('input[name="amount"]').nth(0).fill("45000");
  await caption(page, "② 30,000 + 15,000 = 45,000 이 되면 저장할 수 있습니다", 1800);
  await expect(form.getByText(/일치/)).toBeVisible();
  await form.getByRole("button", { name: "저장" }).click();

  const firstRow = main(page).locator("li").first().locator("summary");
  await expect(firstRow.getByText("식비 외 1")).toBeVisible();
  await expect(firstRow.getByText("₩45,000")).toBeVisible();
  await caption(page, "② 목록은 한 건을 두 줄로 — 적요·합계, 그리고 계정 흐름", 2000);

  // ---- 3. 잔액 열 ----
  // .first(): the row's own summary, not the memo disclosure inside the
  // edit form that the same <li> also holds.
  const rowSummary = (i: number) => main(page).locator("li").nth(i).locator("summary").first();

  await caption(page, "③ 합계 아래 회색 숫자는 그 거래 직후의 잔액입니다", 2000);
  await expect(main(page).getByText("잔액 · 순자산")).toBeVisible();
  await expect(rowSummary(0)).toContainText("₩4,943,000");
  await expect(rowSummary(1)).toContainText("₩4,988,000");
  await caption(page, "③ 4,988,000 − 45,000 = 4,943,000 — 필터가 없으면 순자산입니다", 2600);

  await main(page).getByText("검색·필터").click();
  const filterForm = main(page)
    .locator("form")
    .filter({ has: page.locator('select[name="accountId"]') });
  await filterForm.locator('select[name="accountId"]').selectOption({ label: "신용카드" });
  await caption(page, "③ 계정 하나로 좁히면 그 계정의 잔액으로 바뀝니다", 1800);
  await filterForm.getByRole("button", { name: "조회" }).click();

  await expect(main(page).getByText("잔액 · 신용카드")).toBeVisible();
  await expect(rowSummary(0)).toContainText("₩57,000");
  await expect(rowSummary(1)).toContainText("₩12,000");
  await caption(page, "③ 카드값이 12,000 → 57,000으로 쌓인 게 그대로 보입니다", 2600);

  // ---- 4. 계정과목 ----
  await goto(page, "/accounts", "④ 계정과목 — 5분류로 관리하고, 계정마다 통화를 지정");
  await main(page).getByPlaceholder("예: 식비").fill("달러예금");
  const newAccountForm = main(page)
    .locator("form")
    .filter({ has: page.getByPlaceholder("예: 식비") });
  await newAccountForm.locator('select[name="group"]').selectOption("asset");
  await newAccountForm.locator('select[name="currency"]').selectOption("USD");
  await caption(page, "④ 자산 그룹에 USD 통화 계정을 추가합니다");
  await newAccountForm.getByRole("button", { name: "추가" }).click();
  await expect(main(page).getByText("달러예금")).toBeVisible({ timeout: 15_000 });

  // 상위 그룹: file two expense accounts under one heading.
  await caption(
    page,
    "④ 계정이 늘면 「상위 그룹」으로 묶습니다 — 식비·생활용품을 한 묶음으로",
    2400,
  );
  for (const name of ["식비", "생활용품"]) {
    const row = main(page).locator("li").filter({ hasText: name }).first();
    await row.locator("summary").click();
    await row.locator('input[name="category"]').fill("먹고사는 것");
    await row.getByRole("button", { name: "저장" }).click();
  }
  await expect(main(page).getByRole("heading", { name: "먹고사는 것" })).toBeVisible();
  await caption(page, "④ 묶이지 않은 계정은 「미분류」로 아래에 남습니다", 2200);

  // ---- 5. 환율 수동 입력 ----
  await goto(page, "/settings", "⑤ 설정 — 환율은 자동 조회하고, 필요하면 직접 보정");
  const rateForm = () =>
    main(page)
      .locator("form")
      .filter({ has: page.locator('input[name="rate"]') });
  await rateForm().locator('input[name="date"]').fill(asOf);
  await rateForm().locator('select[name="base"]').selectOption("USD");
  await rateForm().locator('input[name="rate"]').fill("1300");
  await caption(page, "⑤ 1 USD = 1,300 KRW 로 저장");
  await rateForm().getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText(`${asOf} · 1 USD = 1300 KRW`)).toBeVisible();

  // ---- 6. 다통화 거래 ----
  await goto(page, "/", "⑥ 환전 — 통화가 달라도 기준통화 환산액으로 균형을 맞춥니다");
  form = entryForm(page);
  await form.getByRole("button", { name: "분할" }).click();
  const fxLeft = form.getByTestId("entry-column-left");
  const fxRight = form.getByTestId("entry-column-right");
  await pickAccount(fxLeft, 0, "달러예금");
  await fxLeft.locator('input[name="amount"]').nth(0).fill("1000");
  await pickAccount(fxRight, 0, "은행");
  await fxRight.locator('input[name="amount"]').nth(0).fill("1300000");
  await form.locator('input[name="title"]').fill("환전");
  await caption(page, "⑥ $1,000 × 1,300 = ₩1,300,000 — 환율이 자동으로 채워집니다", 2000);
  await expect(form.getByText(/일치/)).toBeVisible();
  await form.getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText("환전")).toBeVisible();

  // ---- 7. 자산현황 ----
  await goto(page, "/assets", "⑦ 자산현황 — 계정은 자기 통화로, 합계는 기준통화로");
  await expect(main(page).getByText("달러예금")).toBeVisible();
  await caption(page, "⑦ 합계는 거래 시점 환율로 고정된 장부가 기준입니다", 2400);

  // ---- 8. 자산 그래프 ----
  await main(page).getByRole("link", { name: "그래프 보기" }).click();
  await caption(page, "⑧ 자산 그래프 — 숫자만으로는 안 보이는 것", 2000);
  await expect(main(page).getByRole("heading", { name: "순자산 추이" })).toBeVisible();
  await caption(page, "⑧ 한 그래프에 자산·부채·순자산 — 자산과 순자산 사이가 곧 부채입니다", 2400);
  await expect(main(page).getByRole("heading", { name: "자산 구성" })).toBeVisible();
  await main(page).getByText("표로 보기").first().click();
  await caption(page, "⑧ 그래프를 못 읽는 상황에서도 「표로 보기」로 숫자에 닿습니다", 2400);
  await goto(page, "/assets", "⑧ 목록으로 돌아옵니다");

  // ---- 9. 환율 반영 ----
  await goto(page, "/settings", "⑨ 환율이 1,380으로 올랐다고 가정해 보겠습니다");
  await rateForm().locator('input[name="date"]').fill(asOf);
  await rateForm().locator('select[name="base"]').selectOption("USD");
  await rateForm().locator('input[name="rate"]').fill("1380");
  await rateForm().getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText(`${asOf} · 1 USD = 1380 KRW`)).toBeVisible();

  await goto(page, "/assets", "⑨ 장부가는 그대로 두고, 차액은 참고 표시만 합니다");
  await expect(main(page).getByText(/미반영.*\+₩80,000/)).toBeVisible();
  await caption(page, "⑨ +₩80,000 — 아직 손익에 반영되지 않은 평가차액입니다", 2400);
  await main(page).getByRole("button", { name: "환율 반영" }).click();
  await expect(main(page).getByText("반영되었습니다.")).toBeVisible();
  await caption(page, "⑨ 버튼을 눌러야 비로소 실제 거래로 계상됩니다", 1800);
  await expect(main(page).getByText(/장부가.*₩1,380,000/)).toBeVisible();
  await expect(main(page).getByText("미반영")).not.toBeVisible();
  await caption(page, "⑨ 장부가가 갱신되고, USD 잔액 $1,000 자체는 변하지 않습니다", 2600);

  // ---- 10. 기간손익 ----
  await goto(page, "/income", "⑩ 기간손익 — 이번 달 수익·비용·순이익과 12개월 추이");
  await expect(main(page).locator("svg[role='group']")).toBeVisible();
  await expect(main(page).getByText("외화환산이익")).toBeVisible();
  await caption(page, "⑩ 평가이익 계정이 자동 생성되어 수익으로 잡혔습니다", 2600);

  // ---- 11. 예산 ----
  await goto(page, "/budget", "⑪ 예산 — 비용 계정별 월 예산과 집행률");
  const foodRow = main(page).getByTestId("budget-row").filter({ hasText: "식비" });
  await foodRow.locator('input[name="amount"]').fill("50000");
  await caption(page, "⑪ 식비 예산을 ₩50,000으로 설정합니다");
  await foodRow.getByRole("button", { name: "저장" }).click();
  await expect(main(page).getByText(/잔여|초과/)).toBeVisible();
  await caption(page, "⑪ 지출·집행률·잔여가 계산되고, 초과하면 빨간색이 됩니다", 2600);

  // ---- 12. CSV ----
  await goto(page, "/settings", "⑫ CSV — 계정과목·거래·예산·환율 네 가지를 내보내고 가져옵니다");
  const importPanel = main(page).getByTestId("csv-import-transactions");
  await importPanel.scrollIntoViewIfNeeded();
  await caption(page, "⑫ 내보내기는 스트리밍이라 10~15년치도 한 번에 받습니다", 2000);
  // Eight CSV forms would run the page off the bottom of the screen, so
  // each is one row until opened.
  await importPanel.locator("summary").click();
  const importForm = importPanel.locator("form");

  await importForm.locator('input[type="file"]').setInputFiles({
    name: "transactions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "transactionKey,date,kind,title,memo,side,account,currency,amount,rate,baseAmount,lineMemo\n" +
        `T1,${asOf},normal,커피,,left,식비,KRW,4500,1,4500,\n` +
        `T1,${asOf},normal,커피,,right,신용카드,KRW,4500,1,4500,\n` +
        `T2,${asOf},normal,잘못된거래,,left,없는계정,KRW,1000,1,1000,\n` +
        `T2,${asOf},normal,잘못된거래,,right,신용카드,KRW,1000,1,1000,\n`,
      "utf-8",
    ),
  });
  await caption(page, "⑫ 가져오기는 미리보기를 먼저 보여주고, 확정할 때만 씁니다");
  await importForm.getByRole("button", { name: "미리보기" }).click();
  await expect(importForm.getByText(/가져올 거래 1 · 오류 1/)).toBeVisible();
  await caption(page, "⑫ 문제가 있는 거래는 이유와 함께 표시하고 그 건만 건너뜁니다", 2600);
  await importForm.getByRole("button", { name: "가져오기 확정" }).click();
  await expect(importForm.getByText(/생성됨 1/)).toBeVisible();
  await caption(page, "⑫ 확정 — 균형이 맞는 거래 1건만 반영되었습니다", 2200);

  // ---- 13. 언어 전환 ----
  await goto(page, "/assets", "⑬ 헤더 토글 하나로 한국어 ↔ English 전환");
  await page.getByRole("button", { name: "English" }).click();
  await expect(main(page).getByRole("heading", { name: "Balance Sheet" })).toBeVisible();
  await caption(page, "⑬ 문구만 바뀌고 계정 이름과 통화 기호는 그대로입니다", 2600);
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(main(page).getByRole("heading", { name: "자산현황" })).toBeVisible();

  // ---- 14. 다크모드 ----
  await caption(page, "⑭ 다크모드 — 라이트 / 다크 / 시스템 3단 토글", 1600);
  await page.getByRole("button", { name: "다크" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await caption(
    page,
    "⑭ 쿠키에 저장하고 서버가 그대로 그려서 새로고침해도 깜빡임이 없습니다",
    2400,
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await caption(page, "입력 · 자산현황 · 기간손익 · 예산 · CSV · 다국어 · 다크모드", 2600);
});
