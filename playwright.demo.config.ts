import { defineConfig, devices } from "@playwright/test";

/**
 * Separate from playwright.config.ts: this one records a narrated
 * walkthrough of the app for humans to watch, so it runs slowed down,
 * at a fixed size, with video always on. It is not part of `npm run e2e`.
 */
export default defineConfig({
  testDir: "./demo",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // The walkthrough is long and deliberately slow, so give it room.
  timeout: 900_000,
  use: {
    baseURL: "http://localhost:3000",
    // Without this an action on a locator that never becomes actionable
    // waits out the whole test budget and reports only "timeout
    // exceeded" — which says nothing about where it stopped.
    actionTimeout: 20_000,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  // Two recordings, because the phone layout is a different design and
  // not a narrower copy of the desktop one. Each project takes only its
  // own spec.
  projects: [
    {
      name: "desktop",
      testMatch: /walkthrough\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        video: { mode: "on", size: { width: 1280, height: 800 } },
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
          // Slow enough to follow along on screen.
          slowMo: 400,
        },
      },
    },
    {
      name: "mobile",
      testMatch: /walkthrough-mobile\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        video: { mode: "on", size: { width: 393, height: 851 } },
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
          slowMo: 400,
        },
      },
    },
  ],
});
