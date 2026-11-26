/**
 * The Logic step's workflow editors, driven the way an author drives them.
 *
 * Every control is reached by the words on the screen — "Record type", "Which
 * record", "Add a lifecycle step" — never by position, so a field added to an
 * inspector does not shift every step after it. The builder's inspector wraps
 * each control in its own <label>, which is what makes that possible.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { logicPath } from "./session";

export interface Check {
  field: string;
  /** The option value: eq, neq, gt, gte, lt, lte, contains, startsWith, isEmpty, isNotEmpty, changed. */
  test: string;
  value?: string;
}

export const OPERATOR_LABEL: Record<string, string> = {
  eq: "is",
  neq: "is not",
  gt: "is greater than",
  gte: "is greater than or equal to",
  lt: "is less than",
  lte: "is less than or equal to",
  contains: "contains",
  startsWith: "starts with",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  changed: "changed",
};

export type StepScenario =
  | ({ type: "A check" } & Check)
  | ({
      type: "A repeat";
      max: string;
      inside: { entity: string; field: string; value: string };
    } & Check)
  | { type: "Look up a rule table"; rule: string }
  | { type: "Create a record"; entity: string; values: string; saveAs?: string }
  | {
      type: "Update a field";
      entity?: string;
      target?: string;
      field: string;
      value: string;
    }
  | { type: "Delete a record"; entity?: string; target?: string }
  | {
      type: "Work out a value";
      operation: "set" | "copy" | "add" | "subtract" | "multiply" | "divide";
      left: string;
      right?: string;
      saveAs?: string;
    }
  | {
      type: "Call a web service";
      method: "POST" | "PUT" | "PATCH" | "GET" | "DELETE";
      url: string;
      body?: string;
      saveAs?: string;
    };

export type WorkflowScenario =
  | {
      kind: "lifecycle";
      name: string;
      entity: string;
      hooks: Array<{ when: string; handler: string; field?: string }>;
    }
  | {
      kind: "status";
      name: string;
      entity: string;
      states: string[];
      transitions: Array<{ from: string; to: string; trigger?: string }>;
      end: string[];
    }
  | {
      kind: "process";
      name: string;
      entity: string;
      startsFrom: "automatic" | "rule";
      operation?: "CREATE" | "UPDATE" | "DELETE" | "ALL";
      steps: StepScenario[];
    };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** What the ladder says about a step once it is saved and reopened. */
export function stepSentence(step: StepScenario): string[] {
  switch (step.type) {
    case "A check":
      return [
        step.value &&
        step.test !== "isEmpty" &&
        step.test !== "isNotEmpty" &&
        step.test !== "changed"
          ? `${step.field} ${OPERATOR_LABEL[step.test]} ${step.value}`
          : `${step.field} ${OPERATOR_LABEL[step.test]}`,
      ];
    case "A repeat":
      return [
        `while ${step.field} ${OPERATOR_LABEL[step.test]}${step.value ? ` ${step.value}` : ""}`,
        `${step.inside.field} to ${step.inside.value}`,
      ];
    case "Look up a rule table":
      return [`Look up ${step.rule}`];
    case "Create a record":
      return [`Create ${article(step.entity)} ${step.entity}`];
    case "Update a field":
      return [
        step.entity && step.entity !== "" && step.target
          ? `Set ${step.entity}.${step.field} to ${step.value}`
          : `${step.field} to ${step.value}`,
      ];
    case "Delete a record":
      return [step.entity ? `Delete ${article(step.entity)} ${step.entity}` : "Delete a"];
    case "Work out a value":
      return [`${step.operation} ${step.left}${step.right ? ` and ${step.right}` : ""}`];
    case "Call a web service":
      return [`${step.method} to ${step.url}`];
  }
}

const labelled = (scope: Locator, text: string) =>
  scope.getByLabel(new RegExp(`^${escapeRegExp(text)}`)).first();

export class LogicPage {
  constructor(
    readonly page: Page,
    readonly projectId: string
  ) {}

  /** The rail on the left: rules, then workflows. */
  get rail(): Locator {
    return this.page.locator("aside").first();
  }

  /** The automation ladder, for Lifecycle and Process workflows. */
  get builder(): Locator {
    return this.page.locator("div.min-h-\\[560px\\]");
  }

  async open(): Promise<void> {
    await this.page.goto(logicPath({ projectId: this.projectId }));
    // A cold dev server compiles the route on first request.
    await expect(this.page.getByRole("heading", { name: /^Rules(,| and) workflows/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(this.page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });
  }

  async save(): Promise<void> {
    await this.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(this.page.getByText(/Saved to the model/)).toBeVisible({ timeout: 20_000 });
  }

  /** Open a rule or workflow from the rail by its name. */
  async select(name: string): Promise<void> {
    await this.rail
      .getByRole("button", { name: new RegExp(`^\\s*${escapeRegExp(name)}\\b`) })
      .first()
      .click();
  }

  async createWorkflow(workflow: WorkflowScenario): Promise<void> {
    if (workflow.kind === "status") return this.createStatus(workflow);
    if (workflow.kind === "lifecycle") return this.createLifecycle(workflow);
    return this.createProcess(workflow);
  }

  /* ------------------------------------------------------ lifecycle */

  private async createLifecycle(wf: Extract<WorkflowScenario, { kind: "lifecycle" }>) {
    const page = this.page;
    await page.getByRole("button", { name: "New workflow" }).click();
    await page.getByLabel("Workflow name").fill(wf.name);
    await page.getByLabel("Watches").selectOption(wf.entity);
    const first = wf.hooks[0];
    if (!first) throw new Error(`${wf.name} has no hooks`);
    await page.getByLabel("Hook", { exact: true }).selectOption(first.when);
    await page.getByRole("button", { name: "Create workflow" }).click();

    const area = this.builder;
    await area.locator("button", { hasText: "When this happens" }).first().click();
    await this.fillHook(first);
    for (const hook of wf.hooks.slice(1)) await this.addHook(hook);
  }

  /** Add one more rung to the lifecycle ladder that is open. */
  async addHook(hook: { when: string; handler: string; field?: string }): Promise<void> {
    await this.builder.getByText("Add a lifecycle step", { exact: true }).last().click();
    await this.fillHook(hook);
  }

  private async fillHook(hook: { when: string; handler: string; field?: string }) {
    const area = this.builder;
    await labelled(area, "When").selectOption(hook.when);
    await labelled(area, "Handler").fill(hook.handler);
    if (hook.field) await labelled(area, "Field (optional)").selectOption(hook.field);
  }

  /* -------------------------------------------------------- process */

  private async createProcess(wf: Extract<WorkflowScenario, { kind: "process" }>) {
    const area = this.builder;
    await this.rail.getByRole("button", { name: "process", exact: true }).click();
    await area.getByPlaceholder("Name this process").fill(wf.name);
    await labelled(area, "Record type").selectOption(wf.entity);
    await labelled(area, "What starts it").selectOption(wf.startsFrom);
    if (wf.startsFrom === "automatic" && wf.operation) {
      await labelled(area, "Which write")
        .selectOption(wf.operation)
        .catch(async () => {
          await area
            .locator("select")
            .last()
            .selectOption(wf.operation as string);
        });
    }
    for (const step of wf.steps) await this.addStep(step);
  }

  /** Add one step to the end of the process that is open. */
  async addStep(step: StepScenario): Promise<void> {
    const area = this.builder;
    await area.getByText("Add a condition or an action", { exact: true }).last().click();
    await area.locator("button", { hasText: step.type }).first().click();
    const field = (label: string) => labelled(area, label);

    switch (step.type) {
      case "A check":
        await field("Field to look at").selectOption(step.field);
        await field("Test").selectOption(step.test);
        if (step.value !== undefined) await field("Value").fill(step.value);
        return;
      case "A repeat":
        await field("Field to look at").selectOption(step.field);
        await field("Keep going while").selectOption(step.test);
        if (step.value !== undefined) await field("Value").fill(step.value);
        await field("Give up after").fill(step.max);
        // A repeat arrives with one step inside it; fill that one in.
        await area.locator("button", { hasText: "Set a field to" }).first().click();
        await field("Record type").selectOption(step.inside.entity);
        await field("Field to write").selectOption(step.inside.field);
        await field("New value").fill(step.inside.value);
        return;
      case "Look up a rule table":
        await field("Rule table").selectOption(step.rule);
        return;
      case "Create a record":
        await field("Record type").selectOption(step.entity);
        await field("Columns to set").fill(step.values);
        if (step.saveAs) await field("Save the answer as").fill(step.saveAs);
        return;
      case "Update a field":
        if (step.entity) await field("Record type").selectOption(step.entity);
        if (step.target) await field("Which record").fill(step.target);
        await field("Field to write").selectOption(step.field);
        await field("New value").fill(step.value);
        return;
      case "Delete a record":
        if (step.entity) await field("Record type").selectOption(step.entity);
        if (step.target) await field("Which record").fill(step.target);
        return;
      case "Work out a value":
        await field("Operation").selectOption(step.operation);
        await field("Value to work from").fill(step.left);
        if (step.right) await field("And this value").fill(step.right);
        if (step.saveAs) await field("Save the answer as").fill(step.saveAs);
        return;
      case "Call a web service":
        await field("Method").selectOption(step.method);
        await field("URL").fill(step.url);
        if (step.body) await field("Body").fill(step.body);
        if (step.saveAs) await field("Save the answer as").fill(step.saveAs);
        return;
    }
  }

  /* --------------------------------------------------------- status */

  private async createStatus(workflow: Extract<WorkflowScenario, { kind: "status" }>) {
    const page = this.page;
    await this.rail.getByRole("button", { name: "status machine", exact: true }).click();
    await page.locator("label:has-text('Name') input").first().fill(workflow.name);
    await page.locator("label:has-text('Entity') select").first().selectOption(workflow.entity);

    // The canvas starts with its first state; rename it, then add the rest.
    const nodes = page.locator(".react-flow__node");
    await nodes.first().click();
    await page.getByPlaceholder("submitted").fill(workflow.states[0] ?? "draft");
    if (workflow.end.includes(workflow.states[0] as string)) {
      await page.getByText("The process finishes here").click();
    }
    for (const state of workflow.states.slice(1)) {
      await this.addState(state, workflow.end.includes(state));
    }
    await expect(nodes).toHaveCount(workflow.states.length);
    for (const transition of workflow.transitions) await this.addTransition(transition);
  }

  /** Add a state to the status machine that is open. */
  async addState(state: string, end = false): Promise<void> {
    const page = this.page;
    await page.getByRole("button", { name: "Add state" }).click();
    await page.getByPlaceholder("submitted").fill(state);
    if (end) await page.getByText("The process finishes here").click();
  }

  /** Draw a move between two states of the status machine that is open. */
  async addTransition(transition: { from: string; to: string; trigger?: string }): Promise<void> {
    const page = this.page;
    const nodes = page.locator(".react-flow__node");
    // Adding a state re-fits the canvas over 200ms; let it settle first.
    await page.waitForTimeout(400);
    const from = nodes.filter({ hasText: new RegExp(`^\\W*${escapeRegExp(transition.from)}$`) });
    const to = nodes.filter({ hasText: new RegExp(`^\\W*${escapeRegExp(transition.to)}$`) });
    const source = await from.locator(".react-flow__handle-right").boundingBox();
    const target = await to.locator(".react-flow__handle-left").boundingBox();
    if (!source || !target) throw new Error(`no handle for ${transition.from} → ${transition.to}`);
    const before = await page.locator(".react-flow__edge").count();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2, {
      steps: 3,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 14,
    });
    await page.mouse.up();
    await expect(page.locator(".react-flow__edge")).toHaveCount(before + 1);
    if (transition.trigger) {
      // The edge's centre can sit under another edge or a node, so select it by event.
      await page.locator(".react-flow__edge").nth(before).dispatchEvent("click");
      await page.getByPlaceholder("submit", { exact: true }).fill(transition.trigger);
    }
  }

  /** The text of Show EML for whatever is selected. */
  async showEml(): Promise<string> {
    await this.page.getByRole("button", { name: "Show EML" }).click();
    return this.page.locator("pre").last().innerText();
  }
}

/** What the open workflow shows matches what was built: hooks, steps, or states and moves. */
export async function expectWorkflowShown(logic: LogicPage, wf: WorkflowScenario) {
  const page = logic.page;
  if (wf.kind === "status") {
    const eml = await logic.showEml();
    for (const t of wf.transitions) {
      expect(eml, `${wf.name}: ${t.from} → ${t.to}`).toContain(
        `${t.from} --> ${t.to}${t.trigger ? ` : ${t.trigger}` : ""}`
      );
    }
    for (const end of wf.end) expect(eml).toContain(`${end} --> [*]`);
    await expect(page.locator(".react-flow__node")).toHaveCount(wf.states.length);
    return;
  }
  const ladder = logic.builder;
  if (wf.kind === "lifecycle") {
    for (const hook of wf.hooks) {
      await expect(ladder).toContainText(hook.when);
      await expect(ladder).toContainText(hook.handler);
    }
    return;
  }
  for (const step of wf.steps) {
    for (const sentence of stepSentence(step)) await expect(ladder).toContainText(sentence);
  }
}
