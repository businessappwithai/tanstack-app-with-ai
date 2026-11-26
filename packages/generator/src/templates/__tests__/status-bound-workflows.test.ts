/**
 * A workflow bound to a status reaches an application generated from now on.
 *
 * `status: <state>` compiles to an `ENTER:<STATE>` operation, which the generated
 * workflow runner selects when a button moves a record into the state. The column
 * that holds it has to be wide enough, the API has to refuse a binding to a state
 * the flow does not draw, and the buttons are named after the status they move to.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApplication } from "../../pipeline/generate-application";
import { moveLabel } from "../../../../../language/state-field";

const CRM = readFileSync(join(import.meta.dirname, "../../../../../language/examples/crm.eml.mmd"), "utf8");
const BOUND = `
%%meta name: Won Notice
%%meta kind: workflow
%%workflow WonNotice entity: Opportunity kind: saga trigger: automatic operation: UPDATE status: closed_won
flowchart TD
    A([Won]) --> B(Note it)
    B --> C([Done])

    %%step B Formula target: wonNote operation: set value: Won
`;
const TEMPLATES = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs");

let out = "";
const read = (path: string) => readFileSync(join(out, path), "utf8");
/** A generated file by the end of its path — numbering and folders move, names do not. */
const find = (suffix: RegExp) => {
  const hit = (readdirSync(out, { recursive: true }) as string[]).find((file) => suffix.test(file));
  if (!hit) throw new Error(`nothing generated matches ${suffix}`);
  return read(hit);
};

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "status-bound-"));
  await generateApplication({
    sources: `${CRM}\n${BOUND}`,
    projectName: "crm",
    outputDir: out,
    skipCliScaffold: true,
    skipFrontend: true,
    skipTests: true,
    writeManifestFile: false,
  } as any);
}, 240_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("a status-bound saga in a generated backend", () => {
  it("is seeded under the operation the runner selects on a move", () => {
    const seed = find(/seeds\/05_workflow_definitions\.ts$/);
    expect(seed).toContain("operation: 'ENTER:CLOSED_WON'");
    expect(seed).toContain("name: 'WonNotice'");
  });

  it("has a column wide enough to hold the binding", () => {
    expect(find(/migrations\/\d+_widen_workflow_operation\.ts$/)).toContain(
      "ALTER COLUMN operation TYPE varchar(100)"
    );
  });

  it("refuses a binding to a state the flow does not draw", () => {
    const service = read("backend/src/modules/workflow-definitions/workflow-definitions.service.ts");
    expect(service).toContain("ENTER:[A-Z0-9_]+");
    expect(service).toContain("export function assertOperation(");
    expect(service).toContain("does not draw");
  });
});

describe("a press is two transactions", () => {
  it("saves the form first, as the form's own PATCH does, then moves the record", () => {
    const controller = read("backend/src/modules/bus/bus.controller.ts");
    expect(controller).toContain("private async saveBeforeMove(");
    expect(controller).toContain("validateData(entity, data, 'patch')");
    // The move is told the form was just saved, so the record's update workflows are not run twice.
    expect(controller).toContain("afterSave");
    expect(read("backend/src/modules/bus/transition.service.ts")).toContain(
      "request.afterSave ? undefined : ('update' as const)"
    );
  });

  it("says which half refused, and that the save stands", () => {
    const controller = read("backend/src/modules/bus/bus.controller.ts");
    expect(controller).toContain("this.inPhase('save'");
    expect(controller).toContain("'workflow', { version, saved: true }");
  });

  it("puts the failed run and the reason back after the rollback took them", () => {
    const transition = read("backend/src/modules/bus/transition.service.ts");
    expect(transition).toContain("recordFailedRun(tableName, id, failure)");
    expect(transition).toContain("doc_status_message");
    expect(read("backend/src/modules/workflow/workflow.service.ts")).toContain("class WorkflowRunError");
  });

  it("leaves a record a draft when a workflow fails, and sends a refusing rule to Error", () => {
    const promotion = read("backend/src/modules/bus/entity-promotion.service.ts");
    expect(promotion).toContain("err instanceof WorkflowRunError");
    expect(promotion).toContain("markDraft(");
    expect(promotion).toContain("markError(");
  });

  it("is driven by a generated suite", () => {
    const generator = readFileSync(
      join(import.meta.dirname, "../../generators/tests/bun-e2e.generator.ts"),
      "utf8"
    );
    expect(generator).toContain('"06c-status-bound-workflow.test.ts"');
    expect(readFileSync(join(TEMPLATES, "tests/suites/06c-status-bound-workflow.test.ts.hbs"), "utf8")).toContain(
      "ENTER:"
    );
  });
});

describe("the host stores a binding as the operation the runner selects", () => {
  const host = readFileSync(join(TEMPLATES, "frontend/src/lib/logic-host.ts"), "utf8");

  it("writes ENTER:<STATE> for a bound workflow and reads it back as a status", () => {
    expect(host).toContain("statusOperation(automation.onStatus)");
    expect(host).toContain("statusFromOperation(row.operation)");
  });

  it("saves a status flow before the workflows bound to its states", () => {
    expect(host).toContain("flowsFirst");
  });
});

describe("the record form shows what a press came to", () => {
  const actions = readFileSync(join(TEMPLATES, "frontend/src/components/admin/record-actions.tsx"), "utf8");

  it("sends the unsaved form with the press and keeps a refusal on the record", () => {
    expect(actions).toContain("data: unsaved");
    expect(actions).toContain('data-testid="press-refused"');
    expect(actions).toContain("Your changes were saved. ");
    expect(actions).toContain("The status did not change.");
  });

  it("links a refusal to Run History", () => {
    expect(actions).toContain('to="/admin/workflows"');
  });
});

describe("a button is named after the status it moves to", () => {
  it("in the generated lifecycle module", () => {
    const lifecycle = read("backend/src/common/lifecycle.ts");
    expect(lifecycle).toContain("export function lifecycleMoveLabel(_event");
    expect(lifecycle).not.toContain("Move to ");
  });

  it("in the language's own reading", () => {
    expect(moveLabel("close_won", "closed_won")).toBe("Closed won");
    expect(moveLabel("qualify", "QUALIFICATION")).toBe("Qualification");
  });

  it("keeps the event as the move's name", () => {
    expect(read("backend/src/common/lifecycle.ts")).toContain(
      "{ from: 'negotiation', to: 'closed_won', event: 'close_won', label: 'Closed won' }"
    );
  });
});
