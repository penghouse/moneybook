import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Tests share one local SQLite file (both the dev server and specs
  // that write directly via db/client.ts), so keep them serial rather
  // than fighting over file locks across worker processes.
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      // The @mobile specs assert on a phone layout, so running them at
      // desktop width only produces noise — they belong to the project
      // below.
      grepInvert: /@mobile/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
        },
      },
    },
    {
      // The core flows again at phone size. Everything the app was worst
      // at — the nav, the debit/credit pair, touch targets — only shows
      // up under a narrow viewport, and none of it was covered before.
      // Selected by grep so a new @mobile test joins on its own.
      name: "mobile",
      grep: /@mobile/,
      use: {
        ...devices["Pixel 5"],
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
        },
      },
    },
  ],
});
