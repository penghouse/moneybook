import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, budgets, transactionLines, transactions } from "../db/schema";
import { getOrCreateSection } from "../lib/current-section";
import { seedSession, SESSION_COOKIE_NAME } from "./auth-helper";

/**
 * The upstream model is never called from a test — these check the
 * screen's half of the exchange: what it sends, what it shows while it
 * waits, and what it does with the words coming back.
 */
test.describe("analysis", () => {
  let currentUserId = "";

  test.beforeEach(async ({ context }, testInfo) => {
    const seeded = await seedSession(`analysis-${testInfo.testId}@example.com`);
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
    const transport = await byName("교통비");
    const card = await byName("신용카드");

    await db.insert(budgets).values({
      sectionId: section.id,
      accountId: transport.id,
      period: "month",
      periodKey: "2026-08",
      amount: 88_000,
      note: "출장 없으면 이대로",
    });
    const [tx] = await db
      .insert(transactions)
      .values({ sectionId: section.id, date: "2026-08-04", title: "출장", memo: "KTX 왕복 출장" })
      .returning();
    await db.insert(transactionLines).values([
      {
        transactionId: tx.id,
        side: "left",
        accountId: transport.id,
        currency: "KRW",
        amount: 205_000,
        rate: 1,
        baseAmount: 205_000,
        lineOrder: 0,
      },
      {
        transactionId: tx.id,
        side: "right",
        accountId: card.id,
        currency: "KRW",
        amount: 205_000,
        rate: 1,
        baseAmount: 205_000,
        lineOrder: 1,
      },
    ]);
    return section;
  }

  /**
   * Stands in for the route, and records what the screen sent it.
   *
   * `events` are the newline-delimited objects the real route streams —
   * text as it is written, a line per fetch the model made, and the
   * budget proposal when there is one.
   */
  const stubUpstream = async (
    page: import("@playwright/test").Page,
    events: Record<string, unknown>[],
  ) => {
    const sent: { brief: string; question: string; period?: string }[] = [];
    await page.route("**/api/analyze", async (route) => {
      sent.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      });
    });
    return sent;
  };
  const says = (text: string) => [{ t: "text", v: text }];

  test("sends the screen's own figures, and only those", async ({ page }) => {
    await seed(currentUserId);
    const sent = await stubUpstream(page, says("교통비가 계획의 233%입니다."));

    await page.goto("/budget?period=2026-08");
    await page.getByTestId("analysis-open").click();

    // One press, no question box in the way — the screen carries its own.
    await expect(page.getByTestId("analysis-answer")).toHaveText("교통비가 계획의 233%입니다.");
    expect(sent).toHaveLength(1);
    expect(sent[0].question).toContain("다음 달에 뭘 조정하면");

    // The figures and what was written on them, which is the half a bare
    // total cannot supply.
    expect(sent[0].brief).toContain("교통비 계획 ₩88,000 / 실적 ₩205,000");
    // The note on the plan travels — the reader wrote it about the
    // budget, and it is on the screen.
    expect(sent[0].brief).toContain("출장 없으면 이대로");
    // The detail behind the figure does not. Most questions never need
    // to know why, so the model asks when one does.
    expect(sent[0].brief).not.toContain("KTX 왕복 출장");
    expect(sent[0].brief).not.toContain("2026-08-04");

    // And the reader is shown that exact text, not a description of it.
    await page.getByText(/보낸 내용/).click();
    await expect(page.getByTestId("analysis-brief")).toContainText("교통비 계획 ₩88,000");
  });

  test("a follow-up asks again with the same figures", async ({ page }) => {
    await seed(currentUserId);
    const sent = await stubUpstream(page, says("네."));

    await page.goto("/budget?period=2026-08");
    await page.getByTestId("analysis-open").click();
    await expect(page.getByTestId("analysis-answer")).toBeVisible();

    await page.getByTestId("analysis-followup").fill("출장비를 따로 떼면 어때?");
    await page.getByRole("button", { name: "보내기" }).click();

    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].question).toBe("출장비를 따로 떼면 어때?");
    expect(sent[1].brief).toBe(sent[0].brief);
  });

  test("lists what the model went and fetched, beside what was sent", async ({ page }) => {
    await seed(currentUserId);
    await stubUpstream(page, [
      { t: "read", v: "교통비 거래 · 2026-08-01~2026-08-31 · 1건" },
      { t: "text", v: "출장 한 건이 대부분입니다." },
    ]);

    await page.goto("/budget?period=2026-08");
    await page.getByTestId("analysis-open").click();
    await expect(page.getByTestId("analysis-answer")).toBeVisible();

    // Detail leaves only when asked for, so the panel has to say that it
    // was asked for — otherwise 「보낸 내용」 is no longer what was sent.
    await page.getByText(/보낸 내용/).click();
    await expect(page.getByTestId("analysis-reads")).toContainText("교통비 거래");
  });

  test("a budget proposal is ticked and applied, with its reason kept", async ({ page }) => {
    const section = await seed(currentUserId);
    const transport = (await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "교통비")),
    }))!;
    await stubUpstream(page, [
      { t: "text", v: "출장이 반복되면 올리는 쪽이 맞습니다." },
      {
        t: "plan",
        v: [
          {
            accountId: transport.id,
            account: "교통비",
            current: "₩88,000",
            next: "₩150,000",
            amountMajor: 150000,
            why: "출장이 분기마다 반복됨",
          },
        ],
      },
    ]);

    await page.goto("/budget?period=2026-08");
    await page.getByTestId("analysis-open").click();
    const row = page.getByTestId("analysis-plan-row");
    await expect(row).toContainText("₩88,000 → ₩150,000");
    // Ticked already: 적용 is the door that asks.
    await expect(row.getByRole("checkbox")).toBeChecked();

    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByText(/적용했습니다/)).toBeVisible();

    const saved = await db.query.budgets.findFirst({
      where: and(
        eq(budgets.sectionId, section.id),
        eq(budgets.accountId, transport.id),
        eq(budgets.periodKey, "2026-08"),
      ),
    });
    expect(saved?.amount).toBe(150_000);
    // Three months on, 교통비 15만 with nothing beside it is a number
    // nobody can account for.
    expect(saved?.note).toBe("출장이 분기마다 반복됨");
  });

  test("an unticked row is not written", async ({ page }) => {
    const section = await seed(currentUserId);
    const transport = (await db.query.accounts.findFirst({
      where: and(eq(accounts.sectionId, section.id), eq(accounts.name, "교통비")),
    }))!;
    await stubUpstream(page, [
      { t: "text", v: "제안합니다." },
      {
        t: "plan",
        v: [
          {
            accountId: transport.id,
            account: "교통비",
            current: "₩88,000",
            next: "₩900,000",
            amountMajor: 900000,
            why: "아니오",
          },
        ],
      },
    ]);

    await page.goto("/budget?period=2026-08");
    await page.getByTestId("analysis-open").click();
    await page.getByTestId("analysis-plan-row").getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByText(/적용했습니다/)).toBeVisible();

    const saved = await db.query.budgets.findFirst({
      where: and(
        eq(budgets.sectionId, section.id),
        eq(budgets.accountId, transport.id),
        eq(budgets.periodKey, "2026-08"),
      ),
    });
    expect(saved?.amount).toBe(88_000);
  });

  test("says so when the deployment cannot answer, rather than failing silently", async ({
    page,
  }) => {
    await seed(currentUserId);
    await page.route("**/api/analyze", (route) =>
      route.fulfill({ status: 503, json: { error: "not_configured" } }),
    );

    await page.goto("/budget?period=2026-08");
    await page.getByTestId("analysis-open").click();
    await expect(page.getByText(/설정되지 않았습니다/)).toBeVisible();
  });

  test("the comparison names its two periods instead of calling one a plan", async ({ page }) => {
    await seed(currentUserId);
    const sent = await stubUpstream(page, says("8월에만 있던 지출입니다."));

    await page.goto("/compare?from=2026-09-01&to=2026-09-30&scope=flow&against=previous");
    await page.getByTestId("analysis-open").click();
    await expect(page.getByTestId("analysis-answer")).toBeVisible();

    // The first column is the period before, and the brief says so. A
    // brief that called it 계획 would hand the model a premise the book
    // never made.
    expect(sent[0].brief).toContain("이전(2026-08-01~2026-08-31)");
    expect(sent[0].brief).toContain("현재(2026-09-01~2026-09-30)");
    expect(sent[0].brief).not.toContain("계획");
  });

  test("the year sends what it is on course for", async ({ page }) => {
    await seed(currentUserId);
    const sent = await stubUpstream(page, says("교통비가 연 예산을 넘겼습니다."));

    await page.goto("/year?year=2026");
    await page.getByTestId("analysis-open").click();
    await expect(page.getByTestId("analysis-answer")).toBeVisible();

    expect(sent[0].brief).toContain("2026");
    expect(sent[0].brief).toContain("교통비");
    expect(sent[0].question).toContain("연말 전망");
  });
});
