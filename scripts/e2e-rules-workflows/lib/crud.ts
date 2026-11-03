/**
 * Create, read, update and delete — the moves spec 14 makes on every rule and
 * workflow, through the page, and the checks it makes on what the server then
 * holds. The rail, the Save button and the stored model are the same for a rule
 * and a workflow, so they live here once.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { type Author, GENERATED, logicPath, storedModel } from "./session";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The identifier the editor files a rule under — `slugifyRuleName` in
 * `packages/editors/src/components/eml/RuleEditor.tsx`, restated so the spec does
 * not import a React component. A test fails if the two ever disagree, because the
 * stored model is then searched for a name the editor never wrote.
 */
export function ruleIdentifier(title: string): string {
  const identifier = title.trim();
  if (/^[a-z][A-Za-z0-9]*$/.test(identifier)) return identifier;
  return (
    title
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((word, index) =>
        index === 0
          ? word.toLowerCase()
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join("") || "rule"
  );
}

/** `pascalWorkflowName` in `WorkflowEditor.tsx`, restated for the same reason. */
export function workflowIdentifier(title: string): string {
  const cleaned = title.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!cleaned) return "Workflow";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export async function openLogic(page: Page, author: Author): Promise<void> {
  await page.goto(logicPath(author));
  await expect(page.getByRole("heading", { name: /^Rules(,| and) workflows/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
}

export async function saveModel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved to the model/)).toBeVisible({ timeout: 30_000 });
}

/** The rail's row for a rule or workflow, matched on its whole title — "X" is not "X revised". */
export function railRow(page: Page, title: string): Locator {
  return page
    .locator("aside")
    .first()
    .locator("div.group")
    .filter({
      has: page.locator("span.font-medium", { hasText: new RegExp(`^${escapeRegExp(title)}$`) }),
    });
}

/** The open item's name field: a rule's or status machine's "Name", a ladder's heading. */
const nameField = (page: Page) =>
  page.locator("input[aria-label='Name'], label:has(> span:text-is('Name')) input").first();

/**
 * Open a rule or workflow from the rail, and make sure it is the one that opened. In a
 * generated application the model's workflows arrive in the rail a moment after the rest
 * and push it down, so a click aimed at a row could land on another one.
 */
export async function openFromRail(page: Page, title: string): Promise<void> {
  const row = railRow(page, title);
  await expect(row, `"${title}" is in the rail`).toHaveCount(1);
  for (let attempt = 0; attempt < 3; attempt++) {
    await row.locator("button").first().click();
    const opened = await expect(nameField(page))
      .toHaveValue(title, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
    await page.waitForTimeout(1000);
  }
  await expect(nameField(page), `"${title}" opened`).toHaveValue(title);
}

/**
 * Remove whatever an earlier attempt at this test left behind — a retry otherwise collides
 * with the rule or workflow the failed attempt had already saved ("already exists").
 */
export async function removeLeftovers(page: Page, author: Author, titles: string[]): Promise<void> {
  await openLogic(page, author);
  let removed = false;
  for (const title of titles) {
    if ((await railRow(page, title).count()) > 0) {
      await deleteFromRail(page, title);
      removed = true;
    }
  }
  if (removed) await saveModel(page);
}

/** Delete through the rail's bin, which shows on hover. */
export async function deleteFromRail(page: Page, title: string): Promise<void> {
  const row = railRow(page, title);
  await expect(row, `"${title}" is in the rail`).toHaveCount(1);
  await row.hover();
  // By its aria-label: an item titled "Delete Own Record" has an open button whose name
  // also starts with "Delete".
  await row.locator("button[aria-label^='Delete ']").click();
  await expect(row).toHaveCount(0);
}

/** The stored model's lines that open a section: `%%rule x on …`, `%%workflow X entity: …`. */
const sectionLine = (directive: "rule" | "workflow", identifier: string) =>
  new RegExp(`^%%${directive} ${escapeRegExp(identifier)}(\\s|$)`, "m");

const metaName = (title: string) => new RegExp(`^%%meta name: ${escapeRegExp(title)}\\s*$`, "m");

/** What the server holds for one section, once, at the moment of the call. */
export async function expectStored(
  author: Author,
  directive: "rule" | "workflow",
  identifier: string,
  present: boolean,
  title?: string
): Promise<string> {
  const eml = await storedModel(author);
  const line = sectionLine(directive, identifier);
  if (present) {
    expect(eml, `the stored model has %%${directive} ${identifier}`).toMatch(line);
    expect(
      eml.match(new RegExp(line.source, "gm"))?.length,
      `%%${directive} ${identifier} is stored once`
    ).toBe(1);
  } else {
    expect(eml, `the stored model no longer has %%${directive} ${identifier}`).not.toMatch(line);
    if (title) expect(eml, `no section is left named "${title}"`).not.toMatch(metaName(title));
  }
  return eml;
}

/* ------------------------------------------------- the backend, on any target */

interface StoredRuleRow {
  ruleName?: string;
  rule_name?: string;
  title?: string | null;
  entityName?: string;
  entity_name?: string;
  jdmContent?: unknown;
  jdm_content?: unknown;
  isActive?: boolean;
  is_active?: boolean;
}

interface StoredWorkflowRow {
  name: string;
  entity_name?: string;
  kind?: string;
  mermaid_code?: string | null;
  is_active?: boolean;
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api${path}`);
  expect(response.status(), `GET /api${path}`).toBe(200);
  return (await response.json()) as T;
}

/** A generated application's live rules: `sys_rule_definitions` through `/api/rules`. */
async function generatedRules(page: Page): Promise<StoredRuleRow[]> {
  const data = await apiJson<
    StoredRuleRow[] | { rules?: StoredRuleRow[]; items?: StoredRuleRow[] }
  >(page, "/rules?limit=500");
  const rows = Array.isArray(data) ? data : (data.rules ?? data.items ?? []);
  return rows.filter((row) => (row.isActive ?? row.is_active) !== false);
}

/** A generated application's workflows: `sys_workflow_definitions`, both kinds. */
async function generatedWorkflows(page: Page): Promise<StoredWorkflowRow[]> {
  const rows: StoredWorkflowRow[] = [];
  for (const kind of ["automation", "state"]) {
    const data = await apiJson<{ items?: StoredWorkflowRow[] }>(
      page,
      `/workflow-definitions?kind=${kind}&limit=500`
    );
    rows.push(...(data.items ?? []).filter((row) => row.is_active !== false));
  }
  return rows;
}

export interface KeptRule {
  /** The identifier the rule is filed under. */
  id: string;
  title: string;
  entity: string;
  present: boolean;
  /** Wording the stored rule must carry (a message, a function body's text). */
  text?: string;
  /** The priority the model must record; the generated runtime keeps none. */
  priority?: number;
}

/**
 * What the backend keeps for one rule: the project's stored model in the modelling tool,
 * `sys_rule_definitions` in a generated application. Once when present, not at all when
 * not — and in the model, no section left under its title either.
 */
export async function expectRuleKept(page: Page, author: Author, rule: KeptRule): Promise<void> {
  if (!GENERATED) {
    const eml = await expectStored(author, "rule", rule.id, rule.present, rule.title);
    if (!rule.present) return;
    expect(eml).toMatch(
      new RegExp(
        `^%%rule ${escapeRegExp(rule.id)} on ${rule.entity}\\b${
          rule.priority === undefined ? "" : `.*priority: ${rule.priority}\\b`
        }`,
        "m"
      )
    );
    if (rule.text) expect(eml, "the stored rule carries the new wording").toContain(rule.text);
    return;
  }
  const rows = (await generatedRules(page)).filter(
    (row) => (row.ruleName ?? row.rule_name) === rule.id
  );
  if (!rule.present) {
    expect(rows, `sys_rule_definitions no longer has ${rule.id}`).toHaveLength(0);
    return;
  }
  expect(rows, `sys_rule_definitions has ${rule.id} once`).toHaveLength(1);
  const row = rows[0] as StoredRuleRow;
  expect(row.title, "the stored title").toBe(rule.title);
  if (rule.text) {
    expect(JSON.stringify(row.jdmContent ?? row.jdm_content), "the stored graph").toContain(
      rule.text
    );
  }
}

export interface KeptWorkflow {
  id: string;
  title: string;
  entity: string;
  present: boolean;
  /** Text the stored definition must carry (a hook's handler, a move, a step's URL). */
  text?: string;
}

/** What the backend keeps for one workflow, on either target. */
export async function expectWorkflowKept(
  page: Page,
  author: Author,
  workflow: KeptWorkflow
): Promise<void> {
  if (!GENERATED) {
    const eml = await expectStored(
      author,
      "workflow",
      workflow.id,
      workflow.present,
      workflow.title
    );
    if (!workflow.present) return;
    expect(eml).toMatch(
      new RegExp(`^%%workflow ${escapeRegExp(workflow.id)} entity: ${workflow.entity}\\b`, "m")
    );
    if (workflow.text) expect(eml).toContain(workflow.text);
    return;
  }
  const rows = (await generatedWorkflows(page)).filter((row) => row.name === workflow.title);
  if (!workflow.present) {
    expect(rows, `sys_workflow_definitions no longer has "${workflow.title}"`).toHaveLength(0);
    return;
  }
  expect(rows, `sys_workflow_definitions has "${workflow.title}" once`).toHaveLength(1);
  if (workflow.text) {
    expect((rows[0] as StoredWorkflowRow).mermaid_code ?? "", "the stored diagram").toContain(
      workflow.text
    );
  }
}
