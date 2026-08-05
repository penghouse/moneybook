import { expect, test } from "@playwright/test";
import { SESSION_COOKIE_NAME, seedSession } from "./auth-helper";

/**
 * Installability is easy to break silently — a manifest that 404s, an
 * icon path that does not resolve, a display mode that quietly falls
 * back to "browser". These check the parts a browser actually reads.
 */
test("the manifest is served, localized, and its icons resolve", async ({ page, context }) => {
  const { token } = await seedSession("pwa@example.com");
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: token, domain: "localhost", path: "/" },
  ]);
  await page.goto("/");

  const linked = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(linked).toBeTruthy();

  const response = await page.request.get(linked!);
  expect(response.status()).toBe(200);
  const manifest = await response.json();

  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toContain("/");
  expect(manifest.lang).toBe("ko");
  expect(manifest.name).toBe("moneybook");

  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toContain("maskable");

  for (const icon of manifest.icons as { src: string }[]) {
    const icoResponse = await page.request.get(icon.src);
    expect(icoResponse.status(), `${icon.src} is missing`).toBe(200);
    expect(icoResponse.headers()["content-type"]).toContain("image/png");
  }

  // Next emits these from app/icon.png and app/apple-icon.png. Exactly
  // one icon link: the scaffold shipped its own app/favicon.ico, and for
  // a while the Next.js default logo was served alongside our own mark.
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});
