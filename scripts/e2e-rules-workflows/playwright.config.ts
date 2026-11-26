import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the business rule and workflow editors — and only those.
 *
 * Run with `bun run test:e2e:rules-workflows` (see README.md beside this file).
 * The modelling tool is started the way the main suite starts it; the generated
 * application, for 06, is started by `run.ts --generated`.
 *
 * PLAYWRIGHT_CHROMIUM_PATH points at a Chromium already on the machine, for
 * environments where Playwright's own download is not available.
 */

const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: "./specs",
  testMatch: ["**/*.spec.ts"],
  // One database, one author per file, and 02 reads rules 01 wrote: in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A dev server that is still optimising dependencies reloads a page under the test.
  retries: process.env.LOGIC_TARGET === "generated" ? 2 : process.env.CI ? 1 : 0,
  timeout: 180_000,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: Number(process.env.E2E_ACTION_TIMEOUT ?? 30_000),
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "bun run dev",
        cwd: "../..",
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PORT: String(PORT),
          AUTH_LOGIN_MAX_PER_MINUTE: process.env.AUTH_LOGIN_MAX_PER_MINUTE ?? "60",
          AUTH_REGISTER_MAX_PER_MINUTE: process.env.AUTH_REGISTER_MAX_PER_MINUTE ?? "60",
        },
      },
});
