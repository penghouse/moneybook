import { test, expect } from "@playwright/test";

test("unauthenticated visit redirects to /login with a working Google button", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "moneybook" })).toBeVisible();
  const googleButton = page.getByRole("button", { name: "Google로 로그인" });
  await expect(googleButton).toBeVisible();
});
