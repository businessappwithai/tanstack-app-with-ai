/**
 * Build a rule in the graph editor, node by node, from nothing.
 *
 * An author deletes what a new rule starts with and draws their own: a Record,
 * then an Expression, a Decision table, a Function and a Switch, each added from
 * the Components panel, joined by lines, configured, and finally run — in the
 * Simulator and in "Try it" — before the rule is saved and read back.
 *
 * Alongside the happy path this holds the editor to what the model declares:
 * an input is one of the entity's own fields and no others, a status is one of
 * its state machine's states, an answer is one of three, and a rule cannot start
 * a workflow. It also holds the two things the editor must not reach outside
 * for — a CDN (Monaco is the application's own) and the word "Request".
 *
 * Every step attaches a screenshot, so a failing run reads as the walkthrough
 * it was meant to be.
 */

import { expect, type Page, test } from "@playwright/test";
import { RuleGraph } from "../lib/rule-graph";
import { type Author, authorWithProject, browserAs, MODEL_SOURCE } from "../lib/session";

const ENTITY = "Student";

/** The fields of an entity, in the order the ERD declares them. */
function fieldsOf(erd: string, entity: string): string[] {
  const block = new RegExp(`\\n\\s*${entity}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(erd)?.[1] ?? "";
  return [...block.matchAll(/^\s*[A-Za-z][\w[\]]*\s+([A-Za-z_]\w*)/gm)].map((m) => m[1] as string);
}

/** The states a state machine on this entity draws. */
function statesOf(erd: string, entity: string): string[] {
  const machine = new RegExp(
    `%%workflow\\s+\\w+\\s+entity:\\s*${entity}\\s+kind:\\s*state\\s*\\n([\\s\\S]*?)(?=\\n%%|\\n\\n)`
  ).exec(erd)?.[1];
  if (!machine) return [];
  const names = new Set<string>();
  for (const m of machine.matchAll(/^\s*(\[\*\]|\w+)\s*-->\s*(\[\*\]|\w+)/gm)) {
    for (const name of [m[1], m[2]]) if (name && name !== "[*]") names.add(name);
  }
  return [...names];
}

/** Names of every process defined for the entity, as the rule's answer column lists them. */
function workflowsOf(erd: string, entity: string): string[] {
  return [...erd.matchAll(new RegExp(`%%workflow\\s+(\\w+)\\s+entity:\\s*${entity}\\b`, "g"))].map(
    (m) => m[1] as string
  );
}

/** The options the open pick-list is offering (the editor draws them as Ant Design select items). */
async function popupOptions(page: Page): Promise<string[]> {
  await page.locator(".ant-select-item-option-content >> visible=true").first().waitFor();
  return (
    await page.locator(".ant-select-item-option-content >> visible=true").allInnerTexts()
  ).map((text) => text.trim());
}

test.describe("building a rule in the graph editor", () => {
  let author: Author;

  test.beforeAll(async ({ playwright }) => {
    author = await authorWithProject(playwright, "rule-graph");
  });
  test.afterAll(async () => {
    await author.session.request.dispose();
  });

  test("a rule built from nothing, node by node, runs and survives a save", async ({
    browser,
  }, testInfo) => {
    const fields = fieldsOf(MODEL_SOURCE, ENTITY);
    const states = statesOf(MODEL_SOURCE, ENTITY);
    const workflows = workflowsOf(MODEL_SOURCE, ENTITY);
    expect(fields, "the fixture model has a Student").toContain("status");
    expect(states, "…with a state machine").toContain("withdrawn");

    const context = await browserAs(browser, author);
    const page = await context.newPage();
    const cdn: string[] = [];
    page.on("request", (request) => {
      if (/^https?:\/\/[^/]*(jsdelivr|unpkg|cdnjs)/.test(request.url())) cdn.push(request.url());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const graph = new RuleGraph(page);
    const snap = async (name: string) =>
      testInfo.attach(name, {
        body: await graph.editor.screenshot(),
        contentType: "image/png",
      });

    await test.step("a new rule opens on a graph that starts from the Record", async () => {
      await page.goto(`/projects/${author.projectId}/logic`);
      await page.getByRole("button", { name: "New rule" }).click();
      await page.getByLabel("Entity").selectOption(ENTITY);
      await page.getByLabel("Name").first().fill("Student withdrawal guard");
      await graph.waitReady();

      // The first node says what it is, and there is nothing to choose from before the author starts.
      await expect(graph.node("Record")).toBeVisible();
      await expect(graph.editor.getByText("Request", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Start from an example")).toHaveCount(0);
      await expect(page.getByLabel("Runs when")).toHaveCount(0);
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

    await test.step("clear the graph, then add the Record", async () => {
      await graph.clear();
      await snap("02-empty-graph");
      await graph.add("Record");
      await expect(graph.node("Record")).toBeVisible();
      await snap("03-record-added");
    });

    await test.step("add the Expression, Decision table, Function, Switch and Response", async () => {
      await graph.add("Expression");
      await graph.link("Record", "expression1");
      await snap("04-expression-added");
      await graph.add("Decision table");
      await graph.link("expression1", "decisionTable1");
      await snap("05-decision-table-added");
      await graph.add("Function");
      await graph.link("decisionTable1", "function1");
      await snap("06-function-added");
      await graph.add("Switch");
      await graph.link("function1", "switch1");
      await snap("07-switch-added");
      await graph.add("Response");
      await expect(graph.nodes).toHaveCount(6);
      await snap("08-response-added");
    });

    await test.step("configure the Record: its schema is the entity's own fields", async () => {
      await graph.node("Record").getByText("Configure").click();
      await expect(graph.tab("Record")).toBeVisible();
      await expect(graph.editor.getByText("Schema")).toBeVisible();
      await expect.poll(() => graph.codeBoxes(), { timeout: 20_000 }).not.toEqual([]);
      const schema = (await graph.codeBoxes()).find((text) => text.includes('"properties"'));
      expect(schema, "the Record's schema is in a code box").toBeTruthy();
      expect(Object.keys(JSON.parse(schema as string).properties)).toEqual(fields);
      await snap("09-configure-record");
      await graph.openTab("Graph");
    });

    await test.step("configure the Expression: a named value worked out from the record", async () => {
      await graph.node("expression1").getByText("Edit Expression").click();
      await graph.editor
        .getByText("Add row", { exact: true })
        .locator("visible=true")
        .first()
        .click();
      // The first row's two cells, a little below the "Key / Expression" heading.
      const editor = (await graph.editor.boundingBox())!;
      await page.mouse.click(editor.x + 140, editor.y + 107);
      await page.keyboard.insertText("isSixthForm");
      await page.mouse.click(editor.x + 520, editor.y + 107);
      await page.keyboard.insertText("year_group >= 12");
      await page.keyboard.press("Escape");
      await expect(graph.editor).toContainText("isSixthForm");
      await expect(graph.editor).toContainText(/year_group\s*>=\s*12/);
      await snap("10-configure-expression");
      await graph.openTab("Graph");
    });

    await test.step("configure the Decision table: inputs, statuses and answers are only what exists", async () => {
      await graph.node("decisionTable1").getByText("Edit Table").click();

      // The input is one of the entity's fields, picked — there is no box to type one into.
      const input = page.getByLabel("Input field whole record");
      await expect(input.locator("option")).toHaveText(["Whole record (formula)", ...fields]);
      await input.selectOption("status");
      await expect(graph.editor.locator(".grl-dt__add-row").first()).toBeVisible();

      // Two outputs: the answer and its message.
      await graph.editor.locator(".grl-field-edit").filter({ hasText: "output" }).first().click();
      await page.locator("input[value='output']").first().fill("action");
      await page.getByRole("button", { name: "Update" }).click();
      await expect(page.getByText("Output Field")).toHaveCount(0);
      await expect(
        graph.editor.locator(".grl-field-edit").filter({ hasText: "action" })
      ).toBeVisible();
      // The first click after a popup closes is sometimes swallowed by its fade-out.
      const field = page.getByText("Output Field");
      for (let attempt = 0; attempt < 4 && !(await field.isVisible()); attempt++) {
        await graph.editor
          .locator("thead tr:first-child th:nth-child(3) .cta-wrapper button")
          .click();
        await field.waitFor({ timeout: 2500 }).catch(() => {});
      }
      await expect(field).toBeVisible();
      await page.keyboard.type("message");
      await page.getByRole("button", { name: "Create" }).click();
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

      // Row 1: a withdrawn student's change is refused.
      await cell(0, 1).click({ position: { x: 22, y: 20 } });
      await page.getByText("equals", { exact: true }).first().click();
      await cell(0, 1).click({ position: { x: 90, y: 20 } });
      // The values on offer are the states the status machine draws, and no others.
      expect((await popupOptions(page)).sort()).toEqual([...states].sort());
      await page.getByText("withdrawn", { exact: true }).last().click();

      await cell(0, 2).click({ position: { x: 90, y: 20 } });
      // …and the answers are the three a rule may give — never "trigger-workflow".
      expect(await popupOptions(page)).toEqual(["validation-error", "transform", "allow"]);
      await page.getByText("validation-error", { exact: true }).last().click();
      await cell(0, 3).click({ position: { x: 90, y: 20 } });
      await page.keyboard.insertText('"A withdrawn student cannot be changed"');
      await page.keyboard.press("Escape");

      // Row 2: everyone else goes through.
      await cell(1, 2).click({ position: { x: 90, y: 20 } });
      await page.getByText("allow", { exact: true }).last().click();

      await expect(graph.editor.locator("tbody tr").first()).toContainText("withdrawn");
      await expect(graph.editor.locator("tbody tr").first()).toContainText("validation-error");
      await expect(graph.editor.locator("tbody tr").nth(1)).toContainText("allow");
      await snap("11-configure-decision-table");
      await graph.openTab("Graph");
    });

    await test.step("configure the Function: Monaco is the application's own", async () => {
      await graph.node("function1").getByText("Edit Function").click();
      await expect(graph.editor.locator(".monaco-editor >> visible=true").first()).toBeVisible({
        timeout: 30_000,
      });
      // The editor starts from `import zen from 'zen'`, which the compiler refuses.
      expect((await graph.codeBoxes()).join("\n")).not.toMatch(/import\s+zen/);
      await graph.typeIntoCodeBox(
        [
          "export const handler = async (input) => {",
          '  const size = input.isSixthForm ? "sixth form" : "lower school";',
          "  return { ...input, note: size };",
          "};",
        ].join("\n")
      );
      await expect
        .poll(() => graph.codeBoxes())
        .toContainEqual(expect.stringContaining("sixth form"));
      await snap("12-configure-function");
      await graph.openTab("Graph");
    });

    await test.step("configure the Switch: a record with a status carries on to the Response", async () => {
      const condition = graph.node("switch1").locator("input, textarea, .cm-content").first();
      await condition.click();
      await page.keyboard.insertText("status != null");
      await expect(graph.node("switch1")).toContainText("status != null");
      const handles = graph.node("switch1").locator(".react-flow__handle-right");
      expect(await handles.count(), "one branch per condition, and Else").toBeGreaterThanOrEqual(1);
      await graph.link("switch1", "response", 0);
      await snap("13-configure-switch");
    });

    await test.step("run it in the Simulator: the answer, and what each node produced", async () => {
      // ▷ at the bottom-left of the editor's toolbar opens the Simulator panel.
      await graph.openTab("Graph");
      const editor = (await graph.editor.boundingBox())!;
      await page.mouse.click(editor.x + 24, editor.y + editor.height - 24);
      await expect(graph.editor.getByText("Simulator")).toBeVisible();
      await graph.typeIntoCodeBox(
        JSON.stringify({ student_number: "S1", status: "withdrawn", year_group: 12 }, null, 2)
      );
      await graph.editor.getByRole("button", { name: /Run/ }).first().click();
      // The rule's answer, as the application reads it: validation-error is stored as "prevent".
      await expect(
        graph.editor
          .getByText(/prevent/)
          .locator("visible=true")
          .first()
      ).toBeVisible({ timeout: 30_000 });
      await snap("14-simulator-withdrawn");
    });

    await test.step("run it in Try it: a withdrawn student is blocked, an enrolled one is not", async () => {
      const tryIt = page.getByLabel("Try the rule");
      const sample = tryIt.getByLabel(/Sample/);
      await sample.fill(JSON.stringify({ status: "withdrawn", year_group: 12 }));
      await tryIt.getByRole("button", { name: "Run the rule" }).click();
      await expect(tryIt.getByText(/Blocks the write/)).toBeVisible({ timeout: 30_000 });
      await expect(tryIt.getByText(/A withdrawn student cannot be changed/).first()).toBeVisible();

      await sample.fill(JSON.stringify({ status: "enrolled", year_group: 9 }));
      await tryIt.getByRole("button", { name: "Run the rule" }).click();
      await expect(tryIt.getByText(/Lets the write through/)).toBeVisible({ timeout: 30_000 });
      await testInfo.attach("15-try-it", {
        body: await tryIt.screenshot(),
        contentType: "image/png",
      });
    });

    await test.step("nothing in the graph names what does not exist", async () => {
      await expect(page.getByLabel("Names that do not exist")).toHaveCount(0);
      expect(workflows.length, "the fixture defines processes for the entity").toBeGreaterThan(0);
    });

    await test.step("save, then read the rule back from the model", async () => {
      const saved = page.waitForResponse(
        (response) => response.url().endsWith("/eml") && response.request().method() === "PUT"
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const response = await saved;
      expect(response.status(), await response.text()).toBe(200);

      const model = (await (
        await author.session.request.get(`/api/projects/${author.projectId}/eml`)
      ).json()) as { eml: string };
      expect(model.eml).toContain("%%rule studentWithdrawalGuard on Student");
      for (const type of [
        "inputNode",
        "expressionNode",
        "decisionTableNode",
        "functionNode",
        "switchNode",
        "outputNode",
      ]) {
        expect(model.eml, `the saved graph holds a ${type}`).toContain(type);
      }
      expect(model.eml).not.toMatch(/"name":"Request"/);
      expect(model.eml).not.toContain('trigger-workflow\\"}]'); // nothing here starts a workflow

      await page.reload();
      await page.getByText("Student withdrawal guard").first().click();
      await graph.waitReady();
      await expect(graph.nodes).toHaveCount(6);
      await expect(graph.node("Record")).toBeVisible();
      await snap("16-after-reload");
    });

    expect(cdn, "Monaco is served by the application, not a CDN").toEqual([]);
    expect(pageErrors, "no uncaught error in the page").toEqual([]);
    await context.close();
  });
});
