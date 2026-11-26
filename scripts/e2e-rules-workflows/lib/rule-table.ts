/**
 * A rule built in the editor's decision table, the way specs 09 does it, but
 * from data: the Logic step's "New rule" opens on Record → table → Response, so
 * a scenario only names the entity, the input fields, and the rows.
 */

import { expect, type Page } from "@playwright/test";
import type { RuleGraph } from "./rule-graph";
import { GENERATED } from "./session";

export type TryItAnswer = "blocks" | "allows" | "changes" | "nomatch" | "nothing";

const ANSWER_TEXT: Record<TryItAnswer, RegExp> = {
  blocks: /Blocks the write/,
  allows: /Lets the write through/,
  changes: /Changes .+ on the record/,
  nomatch: /No row matched/,
  nothing: /no action|does nothing|nothing/i,
};

export interface TableRuleScenario {
  name: string;
  entity: string;
  priority?: number;
  /** One field name per input column; omit for the whole-record formula column. */
  inputs: string[];
  /** Extra output columns beside `action`. Default: ["message"]. */
  extraOutputs?: string[];
  rows: Array<{
    /** One unary test per input column, typed as written ("> 5", '"a","b"', "[1..9]"). Blank = any. */
    when: string[];
    action: "validation-error" | "transform" | "allow";
    /** Values for the extra output columns, in order, typed as written. */
    answers?: string[];
  }>;
  tryIt: Array<{ sample: Record<string, unknown>; expect: TryItAnswer; message?: string }>;
}

async function clickCell(page: Page, graph: RuleGraph, row: number, col: number, x: number) {
  await graph.editor
    .locator("tbody tr")
    .nth(row)
    .locator("td")
    .nth(col)
    .click({ position: { x, y: 20 } });
}

/**
 * One input cell, by the words on the operator palette: "Number:greater than:60",
 * "Text:is one of:a,b", "Number:between:10,20", "Text:custom:status == \"x\"", "Text:is empty".
 */
export async function setCondition(
  page: Page,
  graph: RuleGraph,
  row: number,
  col: number,
  spec: string
) {
  const [tab, op, ...rest] = spec.split(":");
  const value = rest.join(":");
  await clickCell(page, graph, row, col, 22);
  const popover = page.locator(".op-dropdown-popover:not(.ant-popover-hidden)").last();
  // A column the model types (a status, say) offers only its own kind, with no tab bar.
  const tabButton = popover.locator(".op-type-btn", { hasText: new RegExp(`^${tab}$`) });
  if (await tabButton.count()) await tabButton.first().dispatchEvent("click");
  const operator = popover.getByText(new RegExp(`^\\s*${op}\\s*$`, "i")).first();
  await operator.dispatchEvent("click");
  await page.waitForTimeout(300);
  if (!value) return;
  await clickCell(page, graph, row, col, 90);
  if (value === "true" || value === "false") {
    // A boolean's value is a pick between two words, not a text box.
    const option = page.getByText(value, { exact: true }).last();
    if (await option.isVisible().catch(() => false)) await option.click().catch(() => {});
    await page.keyboard.press("Escape");
    return;
  }
  const parts = op === "between" || /one of/.test(op as string) ? value.split(",") : [value];
  if (op !== "between") await page.keyboard.press("Control+A");
  for (const [i, part] of parts.entries()) {
    if (i > 0) await page.keyboard.press(op === "between" ? "Tab" : "Enter");
    await page.keyboard.insertText(part);
  }
  await page.keyboard.press("Enter");
  // Close whatever popup the value editor left open before the next cell is touched.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

/**
 * Open the "Output Field" dialog. The add-column control is a toggle: clicking it again while
 * the dialog is still opening closes it, which is what a click-and-retry loop on a slower page
 * did. So click once, give it time, and only after a Escape (to leave the toggle closed) click again.
 */
async function openOutputFieldDialog(page: Page, graph: RuleGraph) {
  // The dialog is open when its Create button is: the title text also belongs to the rename
  // popover that has only just closed, and typing into that one creates nothing.
  const create = page.getByRole("button", { name: "Create" });
  await expect(page.getByRole("button", { name: "Update" })).toHaveCount(0);
  // The edit just made reaches the page's state a moment later and re-renders the editor, which
  // closes a dialog opened in between. Let it settle first.
  await page.waitForTimeout(1500);
  for (let attempt = 0; attempt < 3; attempt++) {
    await graph.editor.locator("thead tr:first-child th .cta-wrapper button").last().click();
    if (
      await create.waitFor({ state: "visible", timeout: 10_000 }).then(
        () => true,
        () => false
      )
    ) {
      return;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  await expect(create).toBeVisible();
}

/**
 * Click a cell until its value editor holds the focus. Typing before it does sends the text to
 * whatever else is focused — on a slower page, a link, and the Enter that follows follows it.
 */
async function focusCellEditor(page: Page, graph: RuleGraph, row: number, col: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await clickCell(page, graph, row, col, 90);
    await page.waitForTimeout(300);
    const inEditor = await page.evaluate(() => {
      const active = document.activeElement;
      return !!active && !!active.closest(".grl-dt, .monaco-editor, .ant-popover, .ant-select");
    });
    if (inEditor) return;
    await page.keyboard.press("Escape");
  }
}

/** Type a value into a table cell (a message, a value) — replacing what it held. */
export async function setTypedCell(
  page: Page,
  graph: RuleGraph,
  row: number,
  col: number,
  value: string
) {
  await focusCellEditor(page, graph, row, col);
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(value);
  await page.keyboard.press("Enter");
}

/** The answer column is a pick-list; a fresh cell may start in code mode — toggle it once. */
export async function setAnswer(
  page: Page,
  graph: RuleGraph,
  row: number,
  col: number,
  answer: string
) {
  const choice = page.getByText(answer, { exact: true }).last();
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickCell(page, graph, row, col, 90);
    if (await choice.isVisible().catch(() => false)) break;
    await page.keyboard.press("Escape");
    await clickCell(page, graph, row, col, 22);
  }
  await choice.click();
}

export async function startRule(
  page: Page,
  graph: RuleGraph,
  s: Pick<TableRuleScenario, "name" | "entity" | "priority">
) {
  await page.getByRole("button", { name: "New rule" }).click();
  await page.locator("label:has(span:text-is('Entity')) select").selectOption(s.entity);
  await page.getByLabel("Name").first().fill(s.name);
  // A generated application runs every matching rule and has no priority to set.
  if (s.priority !== undefined && !GENERATED)
    await page.locator("label:has(span:text-is('Priority')) input").fill(String(s.priority));
  await graph.waitReady();
}

export async function buildTableRule(page: Page, graph: RuleGraph, s: TableRuleScenario) {
  await startRule(page, graph, s);
  await graph.nodes.filter({ hasText: "Edit Table" }).first().getByText("Edit Table").click();

  // Inputs: the first through the pick-list, the rest with "+ field…".
  const input = page.getByLabel("Input field whole record");
  const extras = s.extraOutputs ?? ["message"];
  for (const [i, field] of s.inputs.entries()) {
    if (i === 0) await input.selectOption(field);
    else await page.getByLabel("Add an input field").selectOption(field);
  }

  // Rename Output → action, then add the extras.
  await graph.editor.locator(".grl-field-edit--output").first().click();
  await page.locator(".ant-popover input, .ant-modal input").first().fill("action");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText("Output Field")).toHaveCount(0);
  for (const name of extras) {
    await openOutputFieldDialog(page, graph);
    await page.keyboard.type(name);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(graph.editor.locator(".grl-field-edit").filter({ hasText: name })).toBeVisible();
  }

  const rows = graph.editor.locator("tbody tr");
  for (let attempt = 0; attempt < 8 && (await rows.count()) < s.rows.length; attempt++) {
    await graph.editor.locator(".grl-dt__add-row").first().click();
    await page.waitForTimeout(400);
  }
  await expect(rows).toHaveCount(s.rows.length);

  await page.waitForTimeout(1500);
  for (const [r, row] of s.rows.entries()) {
    for (const [c, test] of row.when.entries()) {
      if (test) await setCondition(page, graph, r, 1 + c, test);
    }
    const actionCol = 1 + s.inputs.length;
    await setAnswer(page, graph, r, actionCol, row.action);
    for (const [o, value] of (row.answers ?? []).entries()) {
      if (value === "") continue;
      if (value.startsWith("@")) {
        await setAnswer(page, graph, r, actionCol + 1 + o, value.slice(1));
        continue;
      }
      await setTypedCell(page, graph, r, actionCol + 1 + o, value);
    }
  }
  for (const [r, row] of s.rows.entries()) {
    await expect(rows.nth(r)).toContainText(row.action);
  }
  await graph.openTab("Graph");
}

export async function runTryIt(
  page: Page,
  sample: Record<string, unknown>,
  expected: TryItAnswer,
  message?: string
) {
  const tryIt = page.getByLabel("Try the rule");
  await tryIt.getByLabel(/Sample/).fill(JSON.stringify(sample));
  await tryIt.getByRole("button", { name: "Run the rule" }).click();
  await expect(tryIt.getByText(ANSWER_TEXT[expected]).first()).toBeVisible({ timeout: 30_000 });
  if (message) await expect(tryIt.getByText(message).first()).toBeVisible();
}
