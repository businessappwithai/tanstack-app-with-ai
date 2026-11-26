/**
 * What the two editors offer besides building one thing: hit policy, the
 * Developer and Business views, row moves and deletes, the Simulator, deleting
 * a rule or a workflow, attaching a rule to a hook, removing a hook, the help
 * panel, and the checks that refuse a nameless rule. All through the page.
 */

import { expect, type Page, test } from "@playwright/test";
import { LogicPage } from "../lib/logic-page";
import { RuleGraph } from "../lib/rule-graph";
import { buildTableRule, runTryIt, startRule } from "../lib/rule-table";
import {
  type Author,
  authorWithProject,
  browserAs,
  logicPath,
  seededRuleName,
} from "../lib/session";

let author: Author;

test.beforeAll(async ({ playwright }) => {
  author = await authorWithProject(playwright, "editor-features");
});
test.afterAll(async () => {
  await author.session.request.dispose();
});

async function openLogic(page: Page) {
  await page.goto(logicPath(author));
  await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
}

async function saved(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved to the model/)).toBeVisible({ timeout: 30_000 });
}

test.describe("the business rule editor's own controls", () => {
  test("hit policy: Collect answers for every row that fits", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const graph = new RuleGraph(page);
    await openLogic(page);
    await buildTableRule(page, graph, {
      name: "Collect both",
      entity: "Student",
      inputs: ["year_group"],
      rows: [
        { when: ["Number:greater than:0"], action: "validation-error", answers: ['"Registered"'] },
        { when: ["Number:greater than:5"], action: "validation-error", answers: ['"Senior"'] },
      ],
      tryIt: [],
    });
    // First (the default) answers with the first row only…
    await runTryIt(page, { year_group: 9 }, "blocks", "Registered");
    await expect(page.getByLabel("Try the rule").getByText("Senior")).toHaveCount(0);
    // …Collect answers with both.
    await graph.node("collectBoth").getByText("Settings").click();
    await page.getByRole("radio", { name: "Collect" }).check();
    await runTryIt(page, { year_group: 9 }, "blocks", "Registered");
    await expect(page.getByLabel("Try the rule").getByText("Senior").first()).toBeVisible();
    await saved(page);
    await openLogic(page);
    await page.locator("aside").first().getByText("Collect both", { exact: true }).click();
    await graph.waitReady();
    await runTryIt(page, { year_group: 9 }, "blocks", "Senior");
  });

  test("Developer and Business views both show the same rule", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const graph = new RuleGraph(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openLogic(page);
    await startRule(page, graph, { name: "Views probe", entity: "Student" });
    await page.getByRole("button", { name: "Developer", exact: true }).click();
    await expect(graph.nodes).toHaveCount(3);
    await page.getByRole("button", { name: "Business", exact: true }).click();
    await expect(graph.nodes).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test("a row can be added above or below, removed, and dragged into place", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const graph = new RuleGraph(page);
    await openLogic(page);
    await buildTableRule(page, graph, {
      name: "Row moves",
      entity: "Student",
      inputs: ["status"],
      rows: [
        { when: ["Text:equals:withdrawn"], action: "validation-error", answers: ['"first row"'] },
        { when: ["Text:equals:graduated"], action: "validation-error", answers: ['"second row"'] },
      ],
      tryIt: [],
    });
    await graph.nodes.filter({ hasText: "Edit Table" }).first().getByText("Edit Table").click();
    const rows = graph.editor.locator("tbody tr");
    const arrow = (name: "arrow-up" | "arrow-down") =>
      graph.editor.locator(`[aria-label="${name}"]`).first();

    // Picking a row offers to add one above or below it.
    await rows
      .nth(1)
      .locator("td")
      .first()
      .click({ position: { x: 10, y: 10 } });
    await arrow("arrow-up").click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: /^\s*\d+\s*$/ })).toHaveCount(1);

    // The row that was picked stays picked. Removing it asks first, then it is gone.
    await graph.editor.locator('button:has([aria-label="arrow-up"]) + button').click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("withdrawn");
    await expect(rows.filter({ hasText: "graduated" })).toHaveCount(0);

    // Drag the second row's handle onto the first: they swap.
    await rows.nth(1).locator("td.sort-handler").dragTo(rows.nth(0).locator("td.sort-handler"));
    await expect(rows.nth(1)).toContainText("withdrawn");
  });

  test("the Simulator runs the rule on a typed record", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const graph = new RuleGraph(page);
    await openLogic(page);
    await buildTableRule(page, graph, {
      name: "Sim probe",
      entity: "Student",
      inputs: ["status"],
      rows: [{ when: ["Text:equals:withdrawn"], action: "validation-error", answers: ['"gone"'] }],
      tryIt: [],
    });
    // ▷ at the foot of the graph's left rail.
    await graph.openTab("Graph");
    await graph.editor.locator("button").nth(2).click();
    await expect(graph.editor.getByText("Simulator")).toBeVisible();
    await graph.typeIntoCodeBox(JSON.stringify({ status: "withdrawn" }, null, 2));
    await graph.editor.getByRole("button", { name: /Run/ }).first().click();
    await expect(
      graph.editor
        .getByText(/prevent/)
        .locator("visible=true")
        .first()
    ).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a rule with no entity is refused before it is saved", async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await (await browserAs(browser, author)).newPage();
    await openLogic(page);
    await page.getByRole("button", { name: "New rule" }).click();
    await page.getByLabel("Name").first().fill("No entity yet");
    await page.locator("label:has(span:text-is('Entity')) select").selectOption("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/has no entity/)).toBeVisible({ timeout: 15_000 });
  });

  test("a rule is deleted from the rail and stays deleted", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const graph = new RuleGraph(page);
    await openLogic(page);
    await startRule(page, graph, { name: "Delete me", entity: "Student" });
    await saved(page);
    await openLogic(page);
    const rail = page.locator("aside").first();
    await expect(rail.getByText("Delete me", { exact: true })).toBeVisible();
    await rail.getByLabel("Delete deleteMe").click({ force: true });
    await saved(page);
    await openLogic(page);
    await expect(rail.getByText("Delete me", { exact: true })).toHaveCount(0);
  });
});

test.describe("the workflow editors' own controls", () => {
  test("a rule is attached to a hook, kept, and a hook can be removed", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const logic = new LogicPage(page, author.projectId);
    await logic.open();
    await logic.createWorkflow({
      kind: "lifecycle",
      name: "Attach Probe Hooks",
      entity: "Student",
      hooks: [
        { when: "beforeCreate", handler: "checkBeforeCreate" },
        { when: "afterUpdate", handler: "auditAfterUpdate" },
      ],
    });
    const attach = page.getByLabel("Attach a rule to beforeCreate");
    await attach.selectOption({ label: seededRuleName("Student Record Control") });
    const section = page.getByLabel("Rules attached to this workflow");
    // Rules saved earlier in this project already sit on beforeCreate, so count nothing.
    await expect(section.getByText(seededRuleName("Student Record Control")).first()).toBeVisible();
    // Remove the second hook.
    await logic.builder.locator("button", { hasText: "auditAfterUpdate" }).first().click();
    await logic.builder.getByLabel("Remove this").last().click();
    await logic.save();

    await logic.open();
    await logic.select("Attach Probe Hooks");
    await expect(logic.builder).toContainText("checkBeforeCreate");
    await expect(logic.builder).not.toContainText("auditAfterUpdate");
    await expect(page.getByLabel("Rules attached to this workflow")).toContainText(
      seededRuleName("Student Record Control")
    );
  });

  test("a workflow is deleted from the rail and stays deleted", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browserAs(browser, author)).newPage();
    const logic = new LogicPage(page, author.projectId);
    await logic.open();
    await logic.createWorkflow({
      kind: "lifecycle",
      name: "Delete Probe Hooks",
      entity: "Course",
      hooks: [{ when: "beforeCreate", handler: "doNothing" }],
    });
    await logic.save();
    await logic.open();
    await logic.rail.getByLabel("Delete DeleteProbeHooks").click({ force: true });
    await logic.save();
    await logic.open();
    await expect(logic.rail.getByText("Delete Probe Hooks", { exact: true })).toHaveCount(0);
  });

  test("the Help panel opens and names each editor", async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await (await browserAs(browser, author)).newPage();
    const logic = new LogicPage(page, author.projectId);
    await logic.open();
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await expect(page.getByText(/business rule/i).first()).toBeVisible();
  });
});
