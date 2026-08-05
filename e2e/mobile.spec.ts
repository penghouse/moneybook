import { expect, test, type Locator, type Page } from "@playwright/test";
import { SESSION_COOKIE_NAME, seedSession } from "./auth-helper";

/**
 * The phone-sized pass. Everything the app was worst at only shows up
 * under a narrow viewport, and none of it had any coverage: the debit
 * and credit fields folded onto separate rows, controls were 26–34px
 * tall, and the nav pushed every page sideways.
 *
 * Tagged @mobile so the "mobile" project in playwright.config.ts picks
 * them up; the desktop project skips them.
 */

const PAGES = ["/", "/assets", "/assets/chart", "/income", "/budget", "/accounts", "/settings"];

test.beforeEach(async ({ context }, testInfo) => {
  const { token } = await seedSession(`mobile-${testInfo.testId}@example.com`);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: token, domain: "localhost", path: "/" },
  ]);
});

async function pickAccount(scope: Locator, index: number, name: string) {
  const inputs = scope.locator('input[placeholder="계정 검색"]');
  await inputs.nth(index).click();
  await inputs.nth(index).fill(name);
  await scope.getByRole("button", { name }).first().click();
}

function entryForm(page: Page): Locator {
  return page.locator("main form").first();
}

test("@mobile debit and credit stay side by side, not stacked", async ({ page }) => {
  await page.goto("/");
  const form = entryForm(page);

  await pickAccount(form, 0, "식비");
  await pickAccount(form, 1, "신용카드");

  const boxes = await form.locator('input[placeholder="계정 검색"]').all();
  const left = (await boxes[0].boundingBox())!;
  const right = (await boxes[1].boundingBox())!;

  // Same row, left genuinely to the left. Stacking these would erase the
  // one thing double-entry entry is about.
  expect(Math.abs(left.y - right.y)).toBeLessThan(4);
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
});

test("@mobile the split view keeps each side in its own column", async ({ page }) => {
  await page.goto("/");
  const form = entryForm(page);
  await form.getByRole("button", { name: "분할" }).click();

  const leftColumn = form.getByTestId("entry-column-left");
  const rightColumn = form.getByTestId("entry-column-right");

  const leftBox = (await leftColumn.boundingBox())!;
  const rightBox = (await rightColumn.boundingBox())!;
  expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(rightBox.x + 1);

  // Adding a line to one side leaves the other short — the dashed slot
  // that stretches into the gap is the "add line" button itself.
  await leftColumn.getByRole("button", { name: /줄 추가/ }).click();
  await expect(leftColumn.getByTestId("entry-leg")).toHaveCount(2);
  await expect(rightColumn.getByTestId("entry-leg")).toHaveCount(1);
  await expect(rightColumn.getByRole("button", { name: /줄 추가/ })).toBeVisible();
});

test("@mobile no page scrolls sideways", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll, `${path} overflows`).toBeLessThanOrEqual(client);
  }
});

test("@mobile every visible control is a real touch target", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);

    const small = await page.evaluate(() => {
      const selector = "button, a[href], select, input:not([type=hidden]):not([type=file])";
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({
          // For a composite control — chrome on a wrapper, field inside —
          // the wrapper is what the finger lands on, and the field is
          // inset from it by the border. Measure the marked box.
          rect: (el.closest<HTMLElement>("[data-control]") ?? el).getBoundingClientRect(),
          html: el.outerHTML.slice(0, 90),
        }))
        .filter(({ rect }) => rect.height > 0 && rect.height < 44)
        .map(({ rect, html }) => `${rect.height.toFixed(1)}px ${html}`);
    });

    expect(small, `${path} has controls under 44px`).toEqual([]);
  }
});

test("@mobile the amount field is 16px, so iOS does not zoom on focus", async ({ page }) => {
  await page.goto("/");
  const amount = entryForm(page).locator('input[type="number"]').first();
  const fontSize = await amount.evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(16);
});
