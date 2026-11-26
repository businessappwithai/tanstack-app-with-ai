/**
 * The record lifecycle reaches every application generated from now on.
 *
 * Draft → the status flow → Final, the action buttons, who may press them and
 * the cache expiries are all template changes. A piece that exists in the
 * generator and never reaches an application is the failure this guards: it
 * generates the CRM through the one generation path, into a directory, and
 * reads what landed there.
 */

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApplication } from "../../pipeline/generate-application";

const MODEL = join(import.meta.dirname, "../../../../../language/examples/crm.eml.mmd");
const CACHE_KEYS = [
  "CACHE_TTL_DEFAULT_MS",
  "CACHE_TTL_CAPABILITIES_MS",
  "CACHE_TTL_ACCESS_POLICY_MS",
  "CACHE_TTL_ENTITY_METADATA_MS",
  "CACHE_TTL_IDENTIFIER_FIELDS_MS",
  "CACHE_TTL_DICTIONARY_FIELDS_MS",
  "CACHE_TTL_LIFECYCLE_MS",
];

let out = "";
const read = (path: string) => readFileSync(join(out, path), "utf8");

/**
 * The generated `common/lifecycle.ts`, imported. Copied beside this test first:
 * Vite will not load a module from the system temp directory.
 */
async function importLifecycle(): Promise<any> {
  const copy = join(import.meta.dirname, `.generated-lifecycle-${process.pid}.ts`);
  copyFileSync(join(out, "backend/src/common/lifecycle.ts"), copy);
  try {
    return await import(/* @vite-ignore */ copy);
  } finally {
    rmSync(copy, { force: true });
  }
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "lifecycle-templates-"));
  await generateApplication({
    sources: readFileSync(MODEL, "utf8"),
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

describe("the record lifecycle in a generated backend", () => {
  it("writes every table's lifecycle, with the CRM's drawn moves", () => {
    const lifecycle = read("backend/src/common/lifecycle.ts");
    expect(lifecycle).toContain("bus_opportunity: {");
    expect(lifecycle).toContain("column: 'stage'");
    expect(lifecycle).toContain("afterDraft: 'prospecting'");
    expect(lifecycle).toContain("terminal: ['closed_won', 'closed_lost']");
    expect(lifecycle).toContain("{ from: 'negotiation', to: 'closed_won', event: 'close_won', label: 'Closed won' }");
    // An entity with no machine moves Draft → Final on doc_status.
    expect(lifecycle).toMatch(/bus_product: \{ column: 'doc_status', hasMachine: false/);
    expect(lifecycle).toContain("export function movesFrom(");
  });

  it("migrates to one grant table, the capability view, the move log and the assignee", () => {
    const migration = read("backend/src/migrations/0023_record_lifecycle.ts");
    for (const piece of [
      "CREATE TABLE IF NOT EXISTS sys_access_grant",
      "CREATE OR REPLACE VIEW sys_operation_access",
      "CREATE OR REPLACE VIEW sys_transition_access",
      "CREATE OR REPLACE VIEW sys_user_capability",
      "pg_notify('access_changed'",
      "CREATE TABLE IF NOT EXISTS sys_record_transitions",
      "ADD COLUMN IF NOT EXISTS assigned_to UUID",
      "'bus_opportunity',",
    ]) {
      expect(migration).toContain(piece);
    }
  });

  it("seeds the model's moves as grants, a reopen as its own kind", () => {
    const seed = read("backend/seeds/04b_operation_access.ts");
    expect(seed).toContain("insertInto('sys_access_grant')");
    expect(seed).toContain("{ from: 'negotiation', to: 'closed_won', kind: 'move' }");
    expect(seed).toMatch(/transition: 'reopen',[\s\S]*?kind: 'reopen'/);
  });

  it("states every cache expiry in .env and .env.example, defaulting to 6 seconds", () => {
    for (const file of ["backend/.env", "backend/.env.example"]) {
      const env = read(file);
      for (const key of CACHE_KEYS) expect(env).toContain(`${key}=6000`);
    }
    expect(read("backend/src/common/ttl-cache.ts")).toContain("export function createCache");
    expect(read("backend/src/modules/bus/bus.service.ts")).toContain("createCache<string, EntityMetadata>('entityMetadata')");
    expect(read("backend/src/modules/sys/sys.service.ts")).toContain("createCache<string, unknown>('dictionaryFields')");
  });

  it("serves the action buttons and holds a Final record", () => {
    const controller = read("backend/src/modules/bus/bus.controller.ts");
    expect(controller).toContain("@Get(':entity/:id/actions')");
    expect(controller).toContain("@Post(':entity/:id/transition')");
    expect(read("backend/src/modules/bus/transition.service.ts")).toContain("TRANSITION_FORBIDDEN");
    expect(read("backend/src/modules/auth/guards/entity-access.guard.ts")).toContain("RECORD_FINAL");
    expect(read("backend/src/modules/auth/capability.service.ts")).toContain("sys_user_capability");
  });
});

/**
 * A status flow an administrator redraws in Rules and workflows is the one the
 * application runs. Every reader asks lifecycleOf, so the generated module itself
 * is exercised here: a diagram compiled the way the API compiles a saved one,
 * laid over the model's, and read back through the same functions the transition
 * service and the action buttons use.
 */
describe("a status flow an administrator redraws", () => {
  it("migrates the stored compilation and announces every change", () => {
    const migration = read("backend/src/migrations/0024_editable_lifecycles.ts");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS lifecycle JSONB");
    expect(migration).toContain("pg_notify('lifecycle_changed'");
  });

  it("loads stored flows at start and on notify, and serves them to the front end", () => {
    const store = read("backend/src/modules/workflow-definitions/lifecycle-store.service.ts");
    expect(store).toContain("LISTEN lifecycle_changed");
    expect(store).toContain("applyLifecycleOverrides(next)");
    const module = read("backend/src/modules/workflow-definitions/workflow-definitions.module.ts");
    expect(module).toContain("LifecyclesController");
    expect(module).toContain("LifecycleStore");
    const service = read("backend/src/modules/workflow-definitions/workflow-definitions.service.ts");
    expect(service).toContain("LIFECYCLE_STATES_IN_USE");
    expect(service).toContain("await this.lifecycles.reload()");
  });

  it("never rewrites the edges of a table whose flow was redrawn", () => {
    const seed = read("backend/seeds/05b_workflow_transitions.ts");
    expect(seed).toContain("SELECT entity_name FROM sys_workflow_definitions WHERE kind = 'state'");
    expect(seed).toContain("if (redrawn.has(t.tableName)) continue;");
  });

  it("runs the redrawn flow in place of the model's, through lifecycleOf", async () => {
    const lifecycle: any = await importLifecycle();
    const model = lifecycle.modelLifecycleOf("bus_opportunity");
    const diagram = [
      "stateDiagram-v2",
      `    [*] --> ${model.afterDraft}`,
      ...model.edges.map((edge: any) => `    ${edge.from} --> ${edge.to}${edge.event ? ` : ${edge.event}` : ""}`),
      `    ${model.afterDraft} --> on_hold : put on hold`,
      `    on_hold --> ${model.afterDraft} : resume`,
      ...model.terminal.map((state: string) => `    ${state} --> [*]`),
      "%%rbac role:sales_rep on Opportunity.resume",
    ].join("\n");

    const compiled = lifecycle.lifecycleFromDiagram("bus_opportunity", diagram);
    expect(compiled.problems).toEqual([]);
    expect(compiled.lifecycle.column).toBe("stage");
    expect(compiled.lifecycle.values).toContain("on_hold");

    lifecycle.applyLifecycleOverrides({ bus_opportunity: compiled.lifecycle });
    expect(lifecycle.isLifecycleOverridden("bus_opportunity")).toBe(true);
    const moves = lifecycle.movesFrom(lifecycle.lifecycleOf("bus_opportunity"), model.afterDraft);
    expect(moves.map((move: any) => move.event)).toContain("put_on_hold");
    expect(moves.find((move: any) => move.event === "put_on_hold").label).toBe("On hold");
    expect(lifecycle.findMove(lifecycle.lifecycleOf("bus_opportunity"), "on_hold", { event: "resume" })?.to).toBe(
      model.afterDraft,
    );
    // The model's flow is untouched, and a table with no flow cannot gain one.
    expect(lifecycle.modelLifecycleOf("bus_opportunity").values).not.toContain("on_hold");
    lifecycle.applyLifecycleOverrides({ bus_product: compiled.lifecycle });
    expect(lifecycle.lifecycleOf("bus_product").hasMachine).toBe(false);
    expect(lifecycle.lifecycleOf("bus_opportunity").values).not.toContain("on_hold");
  });

  it("refuses a diagram that cannot be a flow", async () => {
    const lifecycle: any = await importLifecycle();
    expect(lifecycle.lifecycleFromDiagram("bus_opportunity", "stateDiagram-v2\n    a --> b").problems).toHaveLength(2);
    expect(
      lifecycle.lifecycleFromDiagram("bus_opportunity", "stateDiagram-v2\n    [*] --> a\n    a --> final\n    final --> [*]")
        .problems.join(" "),
    ).toContain('"final" is the lifecycle\'s own');
    expect(lifecycle.lifecycleFromDiagram("bus_product", "stateDiagram-v2\n    [*] --> a\n    a --> [*]").lifecycle).toBe(
      undefined,
    );
  });
});
