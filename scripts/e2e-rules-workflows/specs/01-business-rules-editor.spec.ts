/**
 * Forty-one business rules, built in the Logic step's decision table by its own
 * controls and nothing else — no API call writes or checks a rule. Each is
 * tried with sample records in "Try it", saved, then reloaded and tried again to
 * prove the rule that came back from the model answers the same way.
 *
 * `RULES_ONLY=<substring>` runs the rules whose name contains it.
 */

import { expect, test } from "@playwright/test";
import { RuleGraph } from "../lib/rule-graph";
import { buildTableRule, runTryIt } from "../lib/rule-table";
import { type Author, authorWithProject, browserAs, GENERATED, logicPath } from "../lib/session";
import { TABLE_RULES } from "../scenarios/rule-catalogue";

const only = process.env.RULES_ONLY;
const rules = TABLE_RULES.filter((r) => !only || r.name.includes(only));

test.describe("business rule editor — decision-table rules built through the page", () => {
  let author: Author;

  test.beforeAll(async ({ playwright }) => {
    author = await authorWithProject(playwright, "rule-editor");
  });
  test.afterAll(async () => {
    await author.session.request.dispose();
  });

  for (const rule of rules) {
    test(`${rule.name} (${rule.entity})`, async ({ browser }, testInfo) => {
      test.setTimeout(240_000);
      const context = await browserAs(browser, author);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const graph = new RuleGraph(page);

      await page.goto(logicPath(author));
      await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
      await buildTableRule(page, graph, rule);
      for (const t of rule.tryIt) await runTryIt(page, t.sample, t.expect, t.message);

      await testInfo.attach("built", { body: await page.screenshot(), contentType: "image/png" });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(/Saved to the model/)).toBeVisible({ timeout: 30_000 });

      // Reload: the rule that comes back from the model answers the same way.
      await page.goto(logicPath(author));
      await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
      await page.locator("aside").first().getByText(rule.name, { exact: true }).first().click();
      await graph.waitReady();
      await expect(page.locator("label:has(span:text-is('Entity')) select")).toHaveValue(
        rule.entity
      );
      // A stored rule in a running application has no priority to keep.
      if (!GENERATED) {
        await expect(page.locator("label:has(span:text-is('Priority')) input")).toHaveValue(
          String(rule.priority ?? 100)
        );
      }
      for (const t of rule.tryIt) await runTryIt(page, t.sample, t.expect, t.message);

      expect(errors, "no uncaught error in the page").toEqual([]);
      await context.close();
    });
  }
});
