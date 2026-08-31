import { expect, test } from "@playwright/test";
import { SESSION_COOKIE_NAME, seedSession } from "./auth-helper";

/**
 * The navigation was the single worst thing on a phone: six links in a
 * bare flex row with no wrapping and no scroll container, so *every*
 * authenticated page scrolled sideways and "Settings" sat off-screen.
 * These tests pin the fix — the no-horizontal-scroll check is the one
 * that would have caught the original bug.
 */

const PAGES = [
  "/",
  "/assets",
  "/assets/chart",
  "/income",
  "/income/chart",
  "/budget",
  "/formulas",
  "/accounts",
  "/settings",
];
const PHONE = { width: 360, height: 640 };

// A fresh user per *run*, not one shared across the file, and not keyed
// on testId either — testId is stable between runs, so a reused account
// carries its section with it. The favourites test writes to the
// section, and either kind of sharing makes the suite pass once and then
// fail on the "defaults are on the bar" assertions the next time.
test.beforeEach(async ({ context }) => {
  const { token } = await seedSession(`nav-${crypto.randomUUID()}@example.com`);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: token, domain: "localhost", path: "/" },
  ]);
});

// 360px was the only width ever checked, and the nav gained a seventh
// destination — the range where the desktop bar, the title and the
// toggles compete for one row had no coverage at all.
const WIDTHS = [
  { width: 360, height: 640 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
];

test("no page scrolls horizontally at any width", async ({ page }) => {
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll, `${path} overflows at ${size.width}px`).toBeLessThanOrEqual(
        overflow.client,
      );
    }
  }
});

test("drawer opens, lists every destination, and navigates", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");

  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "더보기" }).click();

  const drawer = page.getByRole("dialog", { name: "메뉴" });
  await expect(drawer).toBeVisible();

  // The panel must fill the width it was given. When it collapsed to
  // min-content, Korean labels broke to one glyph per line — so assert on
  // the rendered box, not just on visibility.
  const box = await drawer.boundingBox();
  expect(box!.width).toBeGreaterThan(PHONE.width * 0.7);

  // Opens from the right, on the same side as the 더보기 button that
  // opens it. Asserted on the rendered boxes: a class name cannot show
  // which edge the panel actually landed against. The panel is most of
  // the screen, so "on the right" means its right edge is flush and the
  // scrim sits entirely to its left — not that it starts past centre.
  expect(box!.x + box!.width).toBeCloseTo(PHONE.width, 0);
  const scrim = (await page.getByTestId("drawer-scrim").boundingBox())!;
  expect(scrim.x).toBe(0);
  expect(scrim.x + scrim.width).toBeLessThanOrEqual(box!.x);

  for (const label of ["입력", "자산현황", "기간손익", "예산", "계산식", "계정과목", "설정"]) {
    const link = drawer.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    const linkBox = await link.boundingBox();
    // One line, and a real touch target.
    expect(linkBox!.height).toBeGreaterThanOrEqual(44);
    expect(linkBox!.height).toBeLessThan(70);
  }

  await drawer.getByRole("link", { name: "예산", exact: true }).click();
  await expect(page).toHaveURL(/\/budget$/);
  // Closes itself on navigation rather than covering the page just asked for.
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("Escape and the backdrop both close the drawer", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");

  await page.getByRole("button", { name: "더보기" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "더보기" }).click();
  // By testid, not `.last()`: the scrim and the header's X share an
  // accessible name, and flipping the drawer to the right also flipped
  // which of them "last" means — a positional selector would quietly
  // start clicking the other one.
  await page.getByTestId("drawer-scrim").click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("background does not scroll while the drawer is open", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/settings");

  await page.getByRole("button", { name: "더보기" }).click();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("the bottom bar shows the favourites, and settings changes what is on it", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const bar = page.getByRole("navigation", { name: "메뉴" });
  await expect(bar).toBeVisible();

  // The default four, and nothing else — 계정과목 and 설정 live behind 더보기.
  for (const label of ["입력", "자산현황", "기간손익", "예산"]) {
    await expect(bar.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(bar.getByRole("link", { name: "계정과목", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "더보기" })).toBeVisible();

  await page.goto("/settings");
  const form = page.locator("main form").filter({ has: page.locator('input[value="/accounts"]') });
  await form.locator('input[value="/income"]').uncheck();
  await form.locator('input[value="/accounts"]').check();
  await form.getByRole("button", { name: "저장" }).click();

  await expect(bar.getByRole("link", { name: "계정과목", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "기간손익", exact: true })).toHaveCount(0);
});

test("the bottom bar does not cover the end of the page", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/settings");

  // Scroll to the very bottom: a fixed bar with no room reserved for it
  // sits on top of the last control, and nothing else would catch that.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  // Measure the last *content* element, not <main> itself — main is
  // `flex-1`, so its box always reaches the bottom of the viewport and
  // the reserved room is padding inside it.
  const last = (await page.locator("main > div > *").last().boundingBox())!;
  const bar = (await page.getByRole("navigation", { name: "메뉴" }).boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y + 1);
});

test("tapping the tab you are already on reloads the page", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/budget");

  const tab = page.getByRole("navigation", { name: "메뉴" }).getByRole("link", { name: "예산" });
  await expect(tab).toHaveAttribute("aria-current", "page");

  // A <Link> to where you already are does nothing, which is right for a
  // page that cannot have changed and wrong for every page here — they
  // all read a database a phone in a pocket has no way of hearing about.
  let refetched = false;
  page.on("request", (request) => {
    if (request.url().includes("/budget") && request.headers()["rsc"] !== undefined) {
      refetched = true;
    }
  });
  await tab.click();
  await expect.poll(() => refetched, { timeout: 5000 }).toBe(true);
  await expect(page).toHaveURL(/\/budget$/);
});

test("the period arrows read short and still say which unit they step", async ({ page }) => {
  await page.goto("/budget?period=2026-08");
  const back = page.getByRole("link", { name: "이전 달" });

  // Short on screen — the unit is already there twice, between the
  // arrows and in the 월간/연간 switch below them.
  await expect(back).toHaveText(/^← 이전$/);
  // And still named in full for anyone who cannot see either of those.
  await expect(back).toHaveAttribute("aria-label", "이전 달");

  await page.getByRole("link", { name: "연간" }).click();
  await expect(page.getByRole("link", { name: "이전 해" })).toHaveText(/^← 이전$/);
});

test("desktop shows the horizontal bar and no bottom bar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "더보기" })).toBeHidden();
  const bar = page.locator("header nav");
  await expect(bar.getByRole("link", { name: "자산현황", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
});
