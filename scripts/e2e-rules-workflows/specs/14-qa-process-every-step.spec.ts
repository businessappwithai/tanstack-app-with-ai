/**
 * A QA walk of the workflow editor, built one control at a time through the page:
 *
 *   1. business rules of every kind on FeeInvoice — decision tables answering
 *      validation-error, transform and allow, and graph rules made of Expression,
 *      Function and Switch nodes, alone and chained — each tried in Try it and saved;
 *   2. a lifecycle workflow on every hook that can carry a rule, with one of those
 *      rules attached to each;
 *   3. one process of 56 steps — every step type, seven times over — added one step
 *      at a time, with the ladder checked after every addition, every rule looked up;
 *   4. a second process that a rule starts.
 *
 * Everything is saved, the page reloaded, and the ladders read back. The stored
 * model is written to QA_MODEL_OUT (when set) so it can be generated and run.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { LogicPage, type StepScenario, stepSentence } from "../lib/logic-page";
import { RuleGraph } from "../lib/rule-graph";
import { buildTableRule, runTryIt, startRule, type TableRuleScenario } from "../lib/rule-table";
import { type Author, authorWithProject, browserAs, logicPath, storedModel } from "../lib/session";

const ENTITY = "FeeInvoice";
const camel = (title: string) =>
  title
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : (w[0]?.toUpperCase() ?? "") + w.slice(1).toLowerCase()
    )
    .join("");

/* --------------------------------------------------------------- rules */

const TABLES: TableRuleScenario[] = [
  {
    name: "QA cancelled invoice frozen",
    entity: ENTITY,
    inputs: ["status"],
    rows: [
      {
        when: ["Text:equals:cancelled"],
        action: "validation-error",
        answers: ['"Cancelled invoices are frozen"'],
      },
      { when: ["Text:any"], action: "allow" },
    ],
    tryIt: [
      {
        sample: { status: "cancelled" },
        expect: "blocks",
        message: "Cancelled invoices are frozen",
      },
      { sample: { status: "issued" }, expect: "allows" },
    ],
  },
  {
    name: "QA settled invoice note",
    entity: ENTITY,
    inputs: ["balance_due"],
    extraOutputs: ["field", "value"],
    rows: [
      {
        when: ["Number:equals:0"],
        action: "transform",
        answers: ["@cancellation_reason", '"settled"'],
      },
    ],
    tryIt: [
      { sample: { balance_due: 0 }, expect: "changes" },
      { sample: { balance_due: 5 }, expect: "nomatch" },
    ],
  },
  {
    name: "QA positive total allowed",
    entity: ENTITY,
    inputs: ["total_amount"],
    rows: [{ when: ["Number:greater than:0"], action: "allow" }],
    tryIt: [
      { sample: { total_amount: 10 }, expect: "allows" },
      { sample: { total_amount: 0 }, expect: "nomatch" },
    ],
  },
  {
    name: "QA invoice needs number",
    entity: ENTITY,
    inputs: ["invoice_number"],
    rows: [
      {
        when: ["Text:is empty"],
        action: "validation-error",
        answers: ['"An invoice needs a number"'],
      },
    ],
    tryIt: [
      { sample: { invoice_number: "" }, expect: "blocks", message: "An invoice needs a number" },
      { sample: { invoice_number: "INV-1" }, expect: "nomatch" },
    ],
  },
];

type GraphNode =
  | { kind: "Expression"; rows: Array<[string, string]> }
  | { kind: "Function"; body: string }
  | { kind: "Switch"; condition: string };

interface GraphRuleScenario {
  name: string;
  chain: GraphNode[];
  tryIt: TableRuleScenario["tryIt"];
}

const fn = (lines: string[]): GraphNode => ({
  kind: "Function",
  body: ["export const handler = async (input) => {", ...lines.map((l) => `  ${l}`), "};"].join(
    "\n"
  ),
});

const GRAPHS: GraphRuleScenario[] = [
  {
    name: "QA graph expression owing",
    chain: [{ kind: "Expression", rows: [["owing", "balance_due > 0"]] }],
    tryIt: [{ sample: { balance_due: 20 }, expect: "nothing" }],
  },
  {
    name: "QA graph function cap",
    chain: [
      fn([
        'if (input.total_amount > 1000000) return { action: "validation-error", message: "Invoice too large" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { total_amount: 2000000 }, expect: "blocks", message: "Invoice too large" },
      { sample: { total_amount: 100 }, expect: "allows" },
    ],
  },
  {
    name: "QA graph function clamp",
    chain: [
      fn([
        'if (input.balance_due < 0) return { action: "transform", transformData: { balance_due: 0 } };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { balance_due: -5 }, expect: "changes" },
      { sample: { balance_due: 5 }, expect: "allows" },
    ],
  },
  {
    name: "QA graph switch status",
    chain: [{ kind: "Switch", condition: "status != null" }],
    tryIt: [{ sample: { status: "issued" }, expect: "nothing" }],
  },
  {
    name: "QA graph owing then function",
    chain: [
      { kind: "Expression", rows: [["owing", "balance_due > 0"]] },
      fn([
        'if (input.owing && input.status === "cancelled") return { action: "validation-error", message: "Settle the balance first" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      {
        sample: { status: "cancelled", balance_due: 10 },
        expect: "blocks",
        message: "Settle the balance first",
      },
      { sample: { status: "issued", balance_due: 10 }, expect: "allows" },
    ],
  },
];

/** Every rule this spec builds, by identifier, plus one the model brought. */
const RULE_IDS = [...TABLES.map((r) => camel(r.name)), ...GRAPHS.map((r) => camel(r.name))];
const LOOKUPS = [...RULE_IDS, "invoiceControl"];

/* ----------------------------------------------------------- processes */

const CHECKS: Array<Extract<StepScenario, { type: "A check" }>> = [
  { type: "A check", field: "feeinvoice.total_amount", test: "gte", value: "0" },
  { type: "A check", field: "feeinvoice.balance_due", test: "lt", value: "1000000000" },
  { type: "A check", field: "feeinvoice.status", test: "neq", value: "never" },
  { type: "A check", field: "feeinvoice.invoice_number", test: "isNotEmpty" },
  { type: "A check", field: "feeinvoice.amount_paid", test: "lte", value: "1000000000" },
  { type: "A check", field: "feeinvoice.total_amount", test: "gt", value: "-1" },
  { type: "A check", field: "feeinvoice.due_on", test: "changed" },
];
const OPERATIONS = ["add", "subtract", "multiply", "divide", "copy", "set", "add"] as const;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "GET", "POST"] as const;
// A local echo server the run spec starts (any method, any body), so web calls are observable.
const SERVICE = "http://127.0.0.1:4799/qa-hook";

/** Round r of the eight step types. */
function round(r: number): StepScenario[] {
  const line = `qaLine${r + 1}`;
  const op = OPERATIONS[r] ?? "add";
  const method = METHODS[r] ?? "GET";
  return [
    CHECKS[r] as StepScenario,
    { type: "Look up a rule table", rule: LOOKUPS[r % LOOKUPS.length] as string },
    {
      type: "Work out a value",
      operation: op,
      // "set" stores text as written; every other operation reads a value from the run.
      left: op === "set" ? `qa set ${r + 1}` : "{{feeinvoice.total_amount}}",
      ...(op === "copy" || op === "set" ? {} : { right: String(r + 2) }),
      saveAs: `qaValue${r + 1}`,
    },
    {
      type: "Create a record",
      entity: "FeeInvoiceLine",
      values: [
        "fee_invoice_id: {{feeinvoice.id}}",
        "charge_type: materials",
        `description: QA line ${r + 1}`,
        "quantity: 1",
        "unit_amount: 0",
        "line_total: 0",
      ].join("\n"),
      saveAs: line,
    },
    r % 2 === 0
      ? {
          type: "Update a field",
          entity: "FeeInvoiceLine",
          target: `{{${line}}}`,
          field: "description",
          value: `QA line ${r + 1} updated`,
        }
      : { type: "Update a field", field: "cancellation_reason", value: `qa round ${r + 1}` },
    {
      type: "Call a web service",
      method,
      url: SERVICE,
      ...(method === "POST" || method === "PUT" || method === "PATCH"
        ? { body: `{ "invoice": "{{feeinvoice.id}}", "round": ${r + 1} }` }
        : {}),
      saveAs: `qaResponse${r + 1}`,
    },
    { type: "Delete a record", entity: "FeeInvoiceLine", target: `{{${line}}}` },
    {
      type: "A repeat",
      field: "feeinvoice.status",
      test: "eq",
      value: "never",
      max: String(r + 2),
      inside: { entity: ENTITY, field: "cancellation_reason", value: `loop pass ${r + 1}` },
    },
  ];
}

const MEGA_NAME = "QA Every Step Invoice Run";
const MEGA_STEPS: StepScenario[] = Array.from({ length: 7 }, (_, r) => round(r)).flat();
// The rule lookups after the seventh round, so every rule is asked at least once.
for (const rule of LOOKUPS.slice(7)) MEGA_STEPS.push({ type: "Look up a rule table", rule });

const RULE_STARTED_NAME = "QA Rule Started Settlement";
const RULE_STARTED_STEPS: StepScenario[] = [
  { type: "A check", field: "feeinvoice.balance_due", test: "eq", value: "0" },
  { type: "Look up a rule table", rule: camel("QA settled invoice note") },
  { type: "Work out a value", operation: "copy", left: "{{feeinvoice.total_amount}}" },
  { type: "Update a field", field: "cancellation_reason", value: "settled by rule" },
  {
    type: "Call a web service",
    method: "POST",
    url: SERVICE,
    body: '{ "settled": "{{feeinvoice.id}}" }',
  },
];

const HOOKS: Array<{ when: string; handler: string; rule: string }> = [
  { when: "beforeCreate", handler: "qaBeforeCreate", rule: "QA invoice needs number" },
  { when: "afterCreate", handler: "qaAfterCreate", rule: "QA positive total allowed" },
  { when: "beforeUpdate", handler: "qaBeforeUpdate", rule: "QA cancelled invoice frozen" },
  { when: "afterUpdate", handler: "qaAfterUpdate", rule: "QA settled invoice note" },
  { when: "beforeDelete", handler: "qaBeforeDelete", rule: "QA graph owing then function" },
  { when: "customValidate", handler: "qaCustomValidate", rule: "QA graph function cap" },
];

/* --------------------------------------------------------------- driver */

let author: Author;
/**
 * QA_STATE names a file holding the author's session and project. When it exists the run
 * resumes in that project and skips the rules it already built; otherwise it is written.
 */
const STATE = process.env.QA_STATE;
const RESUMING = !!STATE && existsSync(STATE);
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ playwright }) => {
  if (RESUMING) {
    const saved = JSON.parse(readFileSync(STATE as string, "utf8"));
    const request = await playwright.request.newContext({
      baseURL: saved.baseURL,
      storageState: saved.storageState,
    });
    author = { session: { request } as unknown as Author["session"], projectId: saved.projectId };
  } else {
    author = await authorWithProject(playwright, "qa-every-step");
    if (STATE) {
      writeFileSync(
        STATE,
        JSON.stringify({
          projectId: author.projectId,
          baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
          storageState: await author.session.request.storageState(),
        })
      );
    }
  }
  console.log(`project: ${author.projectId}${RESUMING ? " (resumed)" : ""}`);
});
test.afterAll(async () => {
  if (process.env.QA_MODEL_OUT) writeFileSync(process.env.QA_MODEL_OUT, await storedModel(author));
  await author.session.request.dispose();
});

async function open(page: Page) {
  await page.goto(logicPath(author));
  await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved to the model/)).toBeVisible({ timeout: 30_000 });
}

async function configureNode(page: Page, graph: RuleGraph, node: GraphNode, name: string) {
  if (node.kind === "Expression") {
    await graph.node(name).getByText("Edit Expression").click();
    for (const [i, [key, expr]] of node.rows.entries()) {
      await graph.editor
        .getByText("Add row", { exact: true })
        .locator("visible=true")
        .first()
        .click();
      const box = (await graph.editor.boundingBox())!;
      const y = box.y + 107 + i * 40;
      await page.mouse.click(box.x + 140, y);
      await page.keyboard.insertText(key);
      await page.mouse.click(box.x + 520, y);
      await page.keyboard.insertText(expr);
      await page.keyboard.press("Escape");
    }
    await graph.openTab("Graph");
  } else if (node.kind === "Function") {
    await graph.node(name).getByText("Edit Function").click();
    await expect(graph.editor.locator(".monaco-editor >> visible=true").first()).toBeVisible({
      timeout: 30_000,
    });
    await graph.typeIntoCodeBox(node.body);
    await expect.poll(() => graph.codeBoxes()).toContainEqual(expect.stringContaining("handler"));
    await graph.openTab("Graph");
  } else {
    const condition = graph.node(name).locator("input, textarea, .cm-content").first();
    await condition.click();
    await page.keyboard.insertText(node.condition);
  }
}

/** The rule listed as attached under one hook — the list item, not a picker's option. */
function attachedUnder(section: Locator, hook: string, rule: string): Locator {
  return section
    .locator("div.rounded-lg", { has: section.page().locator("code", { hasText: hook }) })
    .locator("li", { hasText: rule })
    .first();
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const rule of TABLES) {
  test(`rule (decision table): ${rule.name}`, async ({ browser }, info) => {
    test.skip(RESUMING, "built in the project being resumed");
    test.setTimeout(300_000);
    const context = await browserAs(browser, author);
    const page = await context.newPage();
    const errors = watchErrors(page);
    const graph = new RuleGraph(page);
    await open(page);
    await buildTableRule(page, graph, rule);
    for (const t of rule.tryIt) await runTryIt(page, t.sample, t.expect, t.message);
    await info.attach("rule", { body: await page.screenshot(), contentType: "image/png" });
    await save(page);
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const rule of GRAPHS) {
  test(`rule (graph): ${rule.name}`, async ({ browser }, info) => {
    test.skip(RESUMING, "built in the project being resumed");
    test.setTimeout(300_000);
    const context = await browserAs(browser, author);
    const page = await context.newPage();
    const errors = watchErrors(page);
    const graph = new RuleGraph(page);
    await open(page);
    await startRule(page, graph, { name: rule.name, entity: ENTITY });
    await graph.clear();
    await graph.add("Record");
    const names: string[] = [];
    const counts: Record<string, number> = {};
    for (const node of rule.chain) {
      await graph.add(node.kind);
      counts[node.kind] = (counts[node.kind] ?? 0) + 1;
      names.push(`${node.kind.toLowerCase()}${counts[node.kind]}`);
    }
    await graph.add("Response");
    const path = ["Record", ...names, "response"];
    for (let i = 0; i < path.length - 1; i++) {
      await graph.link(path[i] as string, path[i + 1] as string, 0);
    }
    for (const [i, node] of rule.chain.entries()) {
      await configureNode(page, graph, node, names[i] as string);
    }
    for (const t of rule.tryIt) await runTryIt(page, t.sample, t.expect, t.message);
    await info.attach("rule", { body: await graph.editor.screenshot(), contentType: "image/png" });
    await save(page);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("lifecycle: every rule-carrying hook, a rule attached to each", async ({ browser }, info) => {
  test.skip(RESUMING, "built in the project being resumed");
  test.setTimeout(300_000);
  const context = await browserAs(browser, author);
  const page = await context.newPage();
  const errors = watchErrors(page);
  const logic = new LogicPage(page, author.projectId);
  await logic.open();
  await logic.createWorkflow({
    kind: "lifecycle",
    name: "QA Invoice Rule Hooks",
    entity: ENTITY,
    hooks: HOOKS.map(({ when, handler }) => ({ when, handler })),
  });
  const section = page.getByLabel("Rules attached to this workflow");
  for (const hook of HOOKS) {
    // A new rule starts on beforeCreate, so a rule meant for that hook is already
    // attached and its picker rightly leaves it out.
    const picker = page.getByLabel(`Attach a rule to ${hook.when}`);
    if (await picker.locator("option", { hasText: hook.rule }).count()) {
      await picker.selectOption({ label: hook.rule });
    }
    await expect(attachedUnder(section, hook.when, hook.rule)).toBeVisible();
  }
  await info.attach("lifecycle", { body: await page.screenshot(), contentType: "image/png" });
  await logic.save();

  await logic.open();
  await logic.select("QA Invoice Rule Hooks");
  for (const hook of HOOKS) {
    await expect(logic.builder).toContainText(hook.handler);
    await expect(attachedUnder(section, hook.when, hook.rule)).toBeVisible();
  }
  expect(errors).toEqual([]);
  await context.close();
});

/** A resumed run finds a process an earlier attempt already built and saved. */
async function alreadySaved(logic: LogicPage, name: string): Promise<boolean> {
  return (
    RESUMING &&
    (await logic.rail.getByRole("button", { name: new RegExp(`^\\s*${name}\\b`) }).count()) > 0
  );
}

async function buildProcessStepByStep(
  logic: LogicPage,
  name: string,
  startsFrom: "automatic" | "rule",
  steps: StepScenario[],
  info: Parameters<Parameters<typeof test>[1]>[1]
) {
  // Start the process with no steps, then add them one at a time.
  await logic.createWorkflow({
    kind: "process",
    name,
    entity: ENTITY,
    startsFrom,
    ...(startsFrom === "automatic" ? { operation: "UPDATE" as const } : {}),
    steps: [],
  });
  // biome-ignore lint/suspicious/noExplicitAny: addStep is the harness's own step driver
  const addStep = (logic as any).addStep.bind(logic) as (s: StepScenario) => Promise<void>;
  for (const [i, step] of steps.entries()) {
    await test.step(`step ${i + 1}: ${step.type}`, async () => {
      await addStep(step);
      // Every look-up answers as "decision" unless renamed, and two of one name is a problem.
      if (step.type === "Look up a rule table") {
        await logic.builder
          .getByLabel(/^Save the answer as/)
          .first()
          .fill(`qaDecision${i + 1}`);
      }
      for (const sentence of stepSentence(step)) {
        await expect(logic.builder, `step ${i + 1} reads back`).toContainText(sentence);
      }
      if ((i + 1) % 8 === 0) {
        await info.attach(`after step ${i + 1}`, {
          body: await logic.page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
    });
  }
}

test(`process: ${MEGA_NAME} — ${MEGA_STEPS.length} steps, one at a time`, async ({
  browser,
}, info) => {
  test.setTimeout(1_800_000);
  const context = await browserAs(browser, author);
  const page = await context.newPage();
  const errors = watchErrors(page);
  const logic = new LogicPage(page, author.projectId);
  await logic.open();
  if (!(await alreadySaved(logic, MEGA_NAME))) {
    await buildProcessStepByStep(logic, MEGA_NAME, "automatic", MEGA_STEPS, info);
    await info.attach("built", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await logic.save();
  }

  await logic.open();
  await logic.select(MEGA_NAME);
  for (const step of MEGA_STEPS) {
    for (const sentence of stepSentence(step)) await expect(logic.builder).toContainText(sentence);
  }
  await info.attach("reopened", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
  await context.close();
});

test(`process: ${RULE_STARTED_NAME} — started by a rule`, async ({ browser }, info) => {
  test.setTimeout(600_000);
  const context = await browserAs(browser, author);
  const page = await context.newPage();
  const errors = watchErrors(page);
  const logic = new LogicPage(page, author.projectId);
  await logic.open();
  if (!(await alreadySaved(logic, RULE_STARTED_NAME))) {
    await buildProcessStepByStep(logic, RULE_STARTED_NAME, "rule", RULE_STARTED_STEPS, info);
    await logic.save();
  }
  await logic.open();
  await logic.select(RULE_STARTED_NAME);
  for (const step of RULE_STARTED_STEPS) {
    for (const sentence of stepSentence(step)) await expect(logic.builder).toContainText(sentence);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("the stored model carries every rule and both processes", async () => {
  const eml = await storedModel(author);
  for (const id of RULE_IDS) expect(eml, id).toContain(id);
  expect(eml).toContain("QA Invoice Rule Hooks".replace(/\s+/g, ""));
  for (const hook of HOOKS) expect(eml).toContain(hook.handler);
});
