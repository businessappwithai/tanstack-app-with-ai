/**
 * Eleven rules drawn node by node in the graph editor — the Expression,
 * Function and Switch nodes the decision table cannot express — each
 * configured, tried in "Try it", saved and reopened. Page only: nothing here
 * calls an API.
 *
 * `GRAPH_ONLY=<substring>` runs the rules whose name contains it.
 */

import { expect, test } from "@playwright/test";
import { buildGraphRule } from "../lib/graph-rule";
import { RuleGraph } from "../lib/rule-graph";
import { runTryIt } from "../lib/rule-table";
import { type Author, authorWithProject, browserAs, logicPath } from "../lib/session";
import { GRAPH_RULES } from "../scenarios/graph-rule-catalogue";

const only = process.env.GRAPH_ONLY;
const rules = GRAPH_RULES.filter((r) => !only || r.name.includes(only));

test.describe("graph rules — drawn node by node", () => {
  let author: Author;
  test.beforeAll(async ({ playwright }) => {
    author = await authorWithProject(playwright, "graph-rules");
  });
  test.afterAll(async () => {
    await author.session.request.dispose();
  });

  for (const rule of rules) {
    test(`${rule.name} (${rule.entity})`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000);
      const context = await browserAs(browser, author);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const graph = new RuleGraph(page);

      await page.goto(logicPath(author));
      await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
      await buildGraphRule(page, graph, rule);
      await testInfo.attach("graph", {
        body: await graph.editor.screenshot(),
        contentType: "image/png",
      });
      for (const t of rule.tryIt) await runTryIt(page, t.sample, t.expect, t.message);

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(/Saved to the model/)).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await page.locator("aside").first().getByText(rule.name, { exact: true }).first().click();
      await graph.waitReady();
      await expect(graph.nodes).toHaveCount(rule.chain.length + 2);
      expect(errors, "no uncaught error in the page").toEqual([]);
      await context.close();
    });
  }
});
