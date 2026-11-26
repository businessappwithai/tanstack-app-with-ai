#!/usr/bin/env node
/**
 * Drive the modelling tool in headless Chromium: sign in, open a page, optionally
 * click things, and save a screenshot.
 *
 *   node .claude/skills/run-modelling-tool/driver.mjs <path> <out.png> [--click "text"]... [--wait ms] [--new-project model.eml.mmd]
 *
 *   node .claude/skills/run-modelling-tool/driver.mjs /projects /var/tmp/projects.png
 *   node .claude/skills/run-modelling-tool/driver.mjs "/projects/{id}/logic" /var/tmp/logic.png \
 *     --new-project language/examples/crm.eml.mmd      # creates the project first, fills {id}
 *   node .claude/skills/run-modelling-tool/driver.mjs /projects/<id>/logic /var/tmp/logic.png \
 *     --click "Lead Qualification" --wait 4000
 *
 * Prints the final URL and the page's heading, then exits. Env: BASE_URL (default
 * http://localhost:3000), TOOL_EMAIL / TOOL_PASSWORD (default the seeded admin),
 * PLAYWRIGHT_CHROMIUM_PATH (default /opt/pw-browsers/chromium).
 */

import { createRequire } from "node:module";
import path from "node:path";

// Playwright is a root dependency; resolve it from the repository, not from here.
const root = path.resolve(import.meta.dirname, "../../..");
const { chromium } = createRequire(path.join(root, "package.json"))("playwright");

const args = process.argv.slice(2);
const [target, out] = args;
if (!target || !out) {
  console.error('usage: driver.mjs <path> <out.png> [--click "text"]... [--wait ms]');
  process.exit(2);
}
const clicks = [];
let wait = 3000;
let model;
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--click") clicks.push(args[++i]);
  else if (args[i] === "--wait") wait = Number(args[++i]);
  else if (args[i] === "--new-project") model = args[++i];
}

const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
page.on("pageerror", (error) => console.error("page error:", error.message.slice(0, 200)));

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("input[type=email]", process.env.TOOL_EMAIL ?? "admin@admin.com");
await page.fill("input[type=password]", process.env.TOOL_PASSWORD ?? "administrator");
await page.click("button[type=submit]");
await page.waitForURL("**/projects");

let resolved = target;
if (model) {
  // A project is reachable only by the account that owns it (anyone else gets a 404 on
  // /eml), so make one as the signed-in account rather than borrowing another's id.
  const { readFileSync } = await import("node:fs");
  const created = await page.request.post(`${base}/api/projects`, {
    data: { name: `driver ${Date.now()}`, erdCode: readFileSync(path.resolve(model), "utf8") },
  });
  if (!created.ok()) throw new Error(`creating the project answered ${created.status()}`);
  const { project } = await created.json();
  resolved = target.replace("{id}", project.id);
  console.log("project:", project.id);
}
await page.goto(`${base}${resolved}`, { waitUntil: "networkidle" });
await page.waitForTimeout(wait);
for (const text of clicks) {
  await page.getByText(text, { exact: false }).first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out, fullPage: false });

console.log("url:", page.url());
console.log(
  "heading:",
  (
    await page
      .locator("h1")
      .first()
      .innerText()
      .catch(() => "(none)")
  ).trim()
);
console.log("screenshot:", out);
await browser.close();
