/**
 * The rule editor of a generated application, driven the way an author drives it.
 *
 * The same walkthrough as 09 — a Record, an Expression, a Decision table, a
 * Function and a Switch, each dragged from the Components panel, joined,
 * configured, run in the Simulator and in Try it — but in the application the
 * generator wrote, on its own pages and against its own API. What is held:
 * the editor offers only what the model declares (a field, an enum's values,
 * three answers), nothing reaches a CDN, and the rule the author saved then
 * refuses a real write.
 *
 * Run against a started generated application:
 *   E2E_BASE_URL=http://localhost:4000 GEN_DIR=/path/to/app bunx playwright test -c playwright.config.ts specs/10
 */

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { RuleGraph } from "../lib/rule-graph";

const GEN_DIR = process.env.GEN_DIR ?? "/var/tmp/gen2";
const EMAIL = process.env.GEN_EMAIL ?? "admin@admin.com";
const PASSWORD = process.env.GEN_PASSWORD ?? "admin123";
const TABLE = "bus_lead";
const ENTITY_LABEL = "Lead";

/** What the application's own rule model says about the entity. */
const MODEL = ((): Array<{
  table: string;
  fields: Array<{ name: string }>;
  values: Record<string, string[]>;
}> => {
  const text = readFileSync(`${GEN_DIR}/frontend/src/lib/rule-model.ts`, "utf8");
  return JSON.parse(text.slice(text.indexOf("= [") + 2, text.lastIndexOf("];") + 1));
})();
const LEAD = MODEL.find((e) => e.table === TABLE)!;
const fields = LEAD.fields.map((f) => f.name);
const ratings = LEAD.values.rating as string[];

/** The options the open pick-list is offering (the editor draws them as Ant Design select items). */
async function popupOptions(page: Page): Promise<string[]> {
  await page.locator(".ant-select-item-option-content >> visible=true").first().waitFor();
  return (
    await page.locator(".ant-select-item-option-content >> visible=true").allInnerTexts()
  ).map((text) => text.trim());
}

test.use({ viewport: { width: 1900, height: 1300 } });

test.describe("building a rule in a generated application", () => {
  test("a rule built from nothing, node by node, runs, saves, and refuses a real write", async ({
    browser,
  }, testInfo) => {
    const marker = `QA-UI-${Date.now() % 100000}`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdn: string[] = [];
    page.on("request", (request) => {
      if (/^https?:\/\/[^/]*(jsdelivr|unpkg|cdnjs)/.test(request.url())) cdn.push(request.url());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill("input[type=email]", EMAIL);
    await page.fill("input[type=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard");

    const graph = new RuleGraph(page);
    const snap = async (name: string) =>
      testInfo.attach(name, { body: await graph.editor.screenshot(), contentType: "image/png" });

    await test.step("a new rule opens on a graph that starts from the Record", async () => {
      await page.goto("/admin/rules/new", { waitUntil: "networkidle" });
      await page.getByText("Select entity...").click();
      await page.getByRole("option", { name: ENTITY_LABEL, exact: true }).click();
      await page.fill("input[placeholder*='Validate Email']", `Hot lead guard ${marker}`);
      await graph.waitReady();
      await expect(graph.node("Record")).toBeVisible();
      await expect(graph.editor.getByText("Request", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Start from an example")).toHaveCount(0);
      await expect(page.getByLabel("Runs when")).toHaveCount(0);
      await expect(page.getByText("Trigger Operation")).toHaveCount(0);
      for (const kind of [
        "Record",
        "Response",
        "Decision table",
        "Expression",
        "Function",
        "Switch",
      ]) {
        await expect(graph.editor.getByText(kind, { exact: true }).last()).toBeVisible();
      }
      await snap("01-a-new-rule");
    });

    await test.step("clear the graph, then add the nodes", async () => {
      await graph.clear();
      await snap("02-empty-graph");
      await graph.add("Record");
      await graph.add("Expression");
      await graph.link("Record", "expression1");
      await graph.add("Decision table");
      await graph.link("expression1", "decisionTable1");
      await graph.add("Function");
      await graph.link("decisionTable1", "function1");
      await graph.add("Switch");
      await graph.link("function1", "switch1");
      await graph.add("Response");
      await expect(graph.nodes).toHaveCount(6);
      await snap("03-nodes-added");
    });

    await test.step("configure the Record: its schema is the entity's own fields", async () => {
      await graph.node("Record").getByText("Configure").click();
      await expect(graph.tab("Record")).toBeVisible();
      await expect.poll(() => graph.codeBoxes(), { timeout: 20_000 }).not.toEqual([]);
      const schema = (await graph.codeBoxes()).find((text) => text.includes('"properties"'));
      expect(schema, "the Record's schema is in a code box").toBeTruthy();
      expect(Object.keys(JSON.parse(schema as string).properties)).toEqual(fields);
      await snap("04-configure-record");
      await graph.openTab("Graph");
    });

    await test.step("configure the Expression: a named value worked out from the record", async () => {
      await graph.node("expression1").getByText("Edit Expression").click();
      await graph.editor
        .getByText("Add row", { exact: true })
        .locator("visible=true")
        .first()
        .click();
      const editor = (await graph.editor.boundingBox())!;
      await page.mouse.click(editor.x + 140, editor.y + 107);
      await page.keyboard.insertText("isLarge");
      await page.mouse.click(editor.x + 520, editor.y + 107);
      await page.keyboard.insertText("(employee_count ?? 0) >= 1000");
      await page.keyboard.press("Escape");
      await expect(graph.editor).toContainText("isLarge");
      await expect(graph.editor).toContainText("employee_count");
      await snap("05-configure-expression");
      await graph.openTab("Graph");
    });

    await test.step("configure the Decision table: inputs, values and answers are only what exists", async () => {
      await graph.node("decisionTable1").getByText("Edit Table").click();
      const input = page.getByLabel("Input field whole record");
      await expect(input.locator("option")).toHaveText(["Whole record (formula)", ...fields]);
      await input.selectOption("rating");
      await expect(graph.editor.locator(".grl-dt__add-row").first()).toBeVisible();

      await graph.editor.locator(".grl-field-edit").filter({ hasText: "output" }).first().click();
      await page.locator("input[value='output']").first().fill("action");
      await page.getByRole("button", { name: "Update" }).click();
      await expect(page.getByText("Output Field")).toHaveCount(0);
      await expect(
        graph.editor.locator(".grl-field-edit").filter({ hasText: "action" })
      ).toBeVisible();
      const field = page.getByText("Output Field");
      for (let attempt = 0; attempt < 4 && !(await field.isVisible()); attempt++) {
        await graph.editor
          .locator("thead tr:first-child th:nth-child(3) .cta-wrapper button")
          .click();
        await field.waitFor({ timeout: 2500 }).catch(() => {});
      }
      await expect(field).toBeVisible();
      await page.keyboard.type("message");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(
        graph.editor.locator(".grl-field-edit").filter({ hasText: "message" })
      ).toBeVisible();

      const rows = graph.editor.locator("tbody tr");
      for (let attempt = 0; attempt < 6 && (await rows.count()) < 2; attempt++) {
        await graph.editor.locator(".grl-dt__add-row").first().click();
        await page.waitForTimeout(500);
      }
      await expect(rows).toHaveCount(2);
      const cell = (row: number, column: number) =>
        graph.editor.locator("tbody tr").nth(row).locator("td").nth(column);

      // Row 1: a hot lead is refused.
      await cell(0, 1).click({ position: { x: 22, y: 20 } });
      await page.getByText("equals", { exact: true }).first().click();
      await cell(0, 1).click({ position: { x: 90, y: 20 } });
      expect((await popupOptions(page)).sort()).toEqual([...ratings].sort());
      await page.getByText("hot", { exact: true }).last().click();

      await cell(0, 2).click({ position: { x: 90, y: 20 } });
      expect(await popupOptions(page)).toEqual(["validation-error", "transform", "allow"]);
      await page.getByText("validation-error", { exact: true }).last().click();
      await cell(0, 3).click({ position: { x: 90, y: 20 } });
      await page.keyboard.insertText(`"A hot lead is not accepted (${marker})"`);
      await page.keyboard.press("Escape");

      // Row 2: everyone else goes through.
      await cell(1, 2).click({ position: { x: 90, y: 20 } });
      await page.getByText("allow", { exact: true }).last().click();

      await expect(graph.editor.locator("tbody tr").first()).toContainText("hot");
      await expect(graph.editor.locator("tbody tr").first()).toContainText("validation-error");
      await expect(graph.editor.locator("tbody tr").nth(1)).toContainText("allow");
      await snap("06-configure-decision-table");
      await graph.openTab("Graph");
    });

    await test.step("configure the Function: Monaco is the application's own", async () => {
      await graph.node("function1").getByText("Edit Function").click();
      await expect(graph.editor.locator(".monaco-editor >> visible=true").first()).toBeVisible({
        timeout: 30_000,
      });
      expect((await graph.codeBoxes()).join("\n")).not.toMatch(/import\s+zen/);
      await graph.typeIntoCodeBox(
        [
          "export const handler = async (input) => {",
          '  const size = input.isLarge ? "large" : "small";',
          "  return { ...input, note: size };",
          "};",
        ].join("\n")
      );
      await expect.poll(() => graph.codeBoxes()).toContainEqual(expect.stringContaining("large"));
      await snap("07-configure-function");
      await graph.openTab("Graph");
    });

    await test.step("configure the Switch: a record with a rating carries on to the Response", async () => {
      const condition = graph.node("switch1").locator("input, textarea, .cm-content").first();
      await condition.click();
      await page.keyboard.insertText("rating != null");
      await expect(graph.node("switch1")).toContainText("rating != null");
      await graph.link("switch1", "response", 0);
      await snap("08-configure-switch");
    });

    await test.step("run it in the Simulator", async () => {
      await graph.openTab("Graph");
      const editor = (await graph.editor.boundingBox())!;
      await page.mouse.click(editor.x + 24, editor.y + editor.height - 24);
      await expect(graph.editor.getByText("Simulator")).toBeVisible();
      await graph.typeIntoCodeBox(JSON.stringify({ rating: "hot", employee_count: 5000 }, null, 2));
      await graph.editor.getByRole("button", { name: /Run/ }).first().click();
      await expect(
        graph.editor
          .getByText(/prevent/)
          .locator("visible=true")
          .first()
      ).toBeVisible({ timeout: 30_000 });
      await snap("09-simulator-hot");
    });

    await test.step("run it in Try it: a hot lead is blocked, a cold one is not", async () => {
      const tryIt = page.getByLabel("Try the rule");
      const sample = tryIt.getByLabel(/Sample/);
      await sample.fill(JSON.stringify({ rating: "hot", employee_count: 5000 }));
      await tryIt.getByRole("button", { name: "Run the rule" }).click();
      await expect(tryIt.getByText(/Blocks the write/)).toBeVisible({ timeout: 30_000 });
      await sample.fill(JSON.stringify({ rating: "cold", employee_count: 5 }));
      await tryIt.getByRole("button", { name: "Run the rule" }).click();
      await expect(tryIt.getByText(/Lets the write through/)).toBeVisible({ timeout: 30_000 });
      await testInfo.attach("10-try-it", {
        body: await tryIt.screenshot(),
        contentType: "image/png",
      });
    });

    await test.step("save it: it is in the rules list", async () => {
      const saved = page.waitForResponse(
        (r) => r.url().endsWith("/api/rules") && r.request().method() === "POST"
      );
      await page.getByRole("button", { name: /Create Rule/ }).click();
      const response = await saved;
      expect(response.status(), await response.text()).toBe(201);
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await expect(page.getByText(`Hot lead guard ${marker}`)).toBeVisible({ timeout: 30_000 });
    });

    const stored = await (await page.request.get("/api/rules?limit=200")).json();
    const rows: any[] = Array.isArray(stored) ? stored : (stored.items ?? []);
    const rule = rows.find((r) => String(r.ruleName).includes(marker));

    await test.step("what was saved is the graph that was drawn", async () => {
      expect(rule, "the saved rule is listed").toBeTruthy();
      const text =
        typeof rule.jdmContent === "string" ? rule.jdmContent : JSON.stringify(rule.jdmContent);
      for (const type of [
        "inputNode",
        "expressionNode",
        "decisionTableNode",
        "functionNode",
        "switchNode",
        "outputNode",
      ]) {
        expect(text, `the saved graph holds a ${type}`).toContain(type);
      }
    });

    await test.step("it refuses a real write, and lets another through", async () => {
      const owner = (await (await page.request.get("/api/bus/bus_user?limit=1")).json()).data[0].id;
      const lead = (rating: string) => ({
        first_name: "Ui",
        last_name: "Lead",
        company_name: marker,
        email: `ui-${Date.now()}@example.com`,
        lead_source: "web",
        rating,
        status: "new",
        owner_id: owner,
      });
      const refused = await page.request.post("/api/bus/bus_lead", { data: lead("hot") });
      expect(refused.status()).toBe(400);
      expect(JSON.stringify(await refused.json())).toContain("A hot lead is not accepted");
      const allowed = await page.request.post("/api/bus/bus_lead", { data: lead("cold") });
      expect(allowed.status()).toBe(201);
      await page.request.delete(`/api/bus/bus_lead/${(await allowed.json()).id}`);
    });

    await test.step("open it again from the list: the editor shows the same graph", async () => {
      await page.goto(`/admin/rules/${rule.id}/edit`, { waitUntil: "networkidle" });
      await graph.waitReady();
      await expect(graph.nodes).toHaveCount(6);
      for (const name of [
        "Record",
        "expression1",
        "decisionTable1",
        "function1",
        "switch1",
        "Response",
      ]) {
        await expect(graph.node(name)).toBeVisible();
      }
      await snap("11-reopened");
    });

    await test.step("switch it off and delete it for good", async () => {
      await page.goto("/admin/rules", { waitUntil: "networkidle" });
      const row = page
        .getByText(`Hot lead guard ${marker}`)
        .first()
        .locator("xpath=ancestor::div[.//button][1]");
      await row.getByRole("button", { name: "Deactivate rule" }).click();
      await page.getByRole("button", { name: "Deactivate", exact: true }).click();
      await expect(page.getByText(/deactivated/i).first()).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: "Delete rule permanently" }).click();
      await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
      await expect
        .poll(async () => (await page.request.get(`/api/rules/${rule.id}`)).status(), {
          timeout: 15_000,
        })
        .toBe(404);
    });

    await test.step("nothing reached outside, and nothing threw", async () => {
      expect(cdn, "no CDN request").toEqual([]);
      expect(pageErrors, "no page error").toEqual([]);
    });
  });
});
