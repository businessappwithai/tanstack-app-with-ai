/**
 * Runs the browser stack's saga selection against a real PGlite and reports what
 * was selected, what was kept and what was undone. Run by `bound-sagas.test.ts` in
 * a child process: PGlite needs a real runtime, and the test environment here is
 * jsdom.
 *
 * Prints one JSON object on its last line.
 */

import { Database } from "../../../../../templates/wasm/server/lib/db.js";
import {
  recordFailedSaga,
  runTriggeredSagas,
  SagaFailure,
} from "../../../../../templates/wasm/server/lib/sagas.js";

const { PGlite } = (await import("@electric-sql/pglite")) as { PGlite: any };

const pg = await PGlite.create();
const db = new Database(pg);
await db.exec(`
  CREATE TABLE bus_order (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT, deleted_at TIMESTAMPTZ);
  CREATE TABLE bus_note (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), body TEXT, deleted_at TIMESTAMPTZ);
  CREATE TABLE sys_workflow_definitions (
    sys_workflow_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL, entity_name VARCHAR(100), kind VARCHAR(20),
    definition JSONB, is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE sys_workflow_runs (
    sys_workflow_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_name VARCHAR(200) NOT NULL, entity_name VARCHAR(100) NOT NULL, record_id UUID,
    from_state VARCHAR(100), to_state VARCHAR(100), trigger VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'completed', detail JSONB, created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

const order = { name: "Order", tableName: "bus_order", attributes: [{ columnName: "status" }] };
const note = { name: "Note", tableName: "bus_note", attributes: [{ columnName: "body" }] };

/** A step that cannot fail and writes nothing: the browser skips a REST step. */
const quiet = [{ nodeId: "A", type: "REST", props: {} }];
const note1 = [{ nodeId: "A", type: "CreateEntity", props: { entity: "Note", fields: '{"body":"kept?"}' } }];
const breaks = [{ nodeId: "B", type: "CreateEntity", props: { entity: "Note", fields: '{"no_such_column":"x"}' } }];

const saga = (name: string, operation: string, steps: unknown[]) => ({
  name,
  entity: "Order",
  trigger: "automatic",
  operation,
  steps,
});

const model = {
  entities: [order, note],
  workflows: [],
  lifecycle: {},
  sagas: [
    saga("updateOnly", "UPDATE", quiet),
    saga("onApproved", "ENTER:APPROVED", quiet),
    saga("onSigned", "ENTER:SIGNED", quiet),
    saga("onSubmit", "TRANSITION:SUBMIT", quiet),
  ],
};
const names = (runs: Array<{ saga: string }>) => runs.map((run) => run.saga).sort();
const record = (await db.insert("bus_order", { status: "draft" })) as { id: string };
const user = { id: null };

// 1. A plain save is an UPDATE: a saga bound to a status is not selected by it.
const plain = await runTriggeredSagas(db, model, order, record, "UPDATE", [], user);

// 2. A press: the bound ones for the move and its state, and the update ones
//    only if the form was not just saved.
const move = { bound: ["TRANSITION:SUBMIT", "ENTER:APPROVED"], throwOnError: true };
const press = await runTriggeredSagas(db, model, order, record, "UPDATE", [], user, 0, move);
const pressAfterSave = await runTriggeredSagas(db, model, order, record, "UPDATE", [], user, 0, {
  ...move,
  skipAutomatic: true,
});

// 3. A failing saga inside the move's transaction undoes the move alone: what an
//    earlier saga of the same move wrote goes with it, the save before it stays.
await db.insert("bus_note", { body: "saved first, by the press's first transaction" });
const failing = {
  ...model,
  sagas: [saga("writes", "ENTER:APPROVED", note1), saga("breaks", "ENTER:APPROVED", breaks)],
};
let failure: { workflow?: string; operation?: string; reason?: string } | null = null;
try {
  await db.transaction(async (tx: Database) => {
    await runTriggeredSagas(tx, failing, order, record, "UPDATE", [], user, 0, {
      bound: ["ENTER:APPROVED"],
      skipAutomatic: true,
      throwOnError: true,
    });
  });
} catch (error) {
  if (!(error instanceof SagaFailure)) throw error;
  failure = { workflow: error.workflow, operation: error.operation, reason: error.reason };
  await recordFailedSaga(db, order, record, error, user);
}
const notes = (await db.query("SELECT body FROM bus_note ORDER BY body")) as Array<{ body: string }>;
const failedRuns = (await db.query(
  "SELECT workflow_name, status, detail FROM sys_workflow_runs WHERE status = 'failed'"
)) as Array<{ workflow_name: string; status: string; detail: { operation?: string } | string }>;

console.log(
  JSON.stringify({
    plain: names(plain),
    press: names(press),
    pressAfterSave: names(pressAfterSave),
    failure,
    notes: notes.map((row) => row.body),
    failedRuns: failedRuns.map((row) => ({
      workflow: row.workflow_name,
      operation: (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail)?.operation,
    })),
  })
);

process.exit(0);
