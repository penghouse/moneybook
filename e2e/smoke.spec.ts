import { test, expect } from "@playwright/test";

test("home page renders the app title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "moneybook" })).toBeVisible();
});

test("language toggle switches ko/en and persists across reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("나 혼자 쓰는 복식부기 가계부")).toBeVisible();

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("A personal double-entry ledger")).toBeVisible();

  await page.reload();
  await expect(page.getByText("A personal double-entry ledger")).toBeVisible();
});
