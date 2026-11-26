/**
 * Sign in to a generated application and warm its dev server, returning the browser state.
 * Run once, from the config's global setup, so what it waits for is not charged to a test.
 */

import type { Browser } from "@playwright/test";

export async function signInToGeneratedApp(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.fill("input[type=email]", process.env.GENERATED_ADMIN_EMAIL ?? "admin@admin.com");
  await page.fill("input[type=password]", process.env.GENERATED_ADMIN_PASSWORD ?? "admin123");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard");
  await page.waitForLoadState("networkidle");
  // Warm the dev server: the editor's first request compiles Monaco and the GoRules bundle,
  // which can outlast the first test's own waits.
  await page.goto("/admin/automations", { waitUntil: "networkidle", timeout: 480_000 });
  await page
    .getByRole("heading", { name: "Rules and workflows" })
    .waitFor({ timeout: 480_000 })
    .catch(() => {});
  // Open the rule editor once, so Vite finds and optimises its dependencies now rather than
  // during a test, where the reload that follows throws the test's page away.
  await page
    .getByRole("button", { name: "New rule" })
    .click({ timeout: 60_000 })
    .catch(() => {});
  await page
    .locator(".jdm-scope .react-flow")
    .first()
    .waitFor({ timeout: 480_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const state = await context.storageState();
  await context.close();
  return state;
}
