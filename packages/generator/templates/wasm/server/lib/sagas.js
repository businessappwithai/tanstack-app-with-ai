/**
 * The background workflows — a saga's steps, run after the write that started
 * them.
 *
 * A `kind: saga` workflow is a list of steps (`%%step`) compiled into
 * `model.sagas` and seeded into `sys_workflow_definitions`. A rule starts one
 * with a `trigger-workflow` action naming it; a saga declared `trigger:
 * automatic` runs on every write its `operation` names. Until this file, the
 * browser application stored the sagas and never ran one: the rule matched,
 * its row went into `_notifications`, and the step that should have moved an
 * invoice to `paid` did nothing.
 *
 * This is also the only writer of a state field. A person's request may not
 * change one (`bus.routes.js` refuses it); a saga's UpdateEntity step writes it
 * here, directly, the way the NestJS executor writes through Kysely without
 * passing its own access guard. Row targeting follows that executor exactly:
 *
 *   no entity                the triggering record
 *   entity + targetSource    the row whose id is that context value (a column of
 *                            the triggering record, or what an earlier step
 *                            published)
 *   entity + targetField     the rows whose targetField equals the triggering
 *                            record's id — children pointing back at it
 *
 * Steps it does not run here (Decision, REST, Agent, Formula beyond a copy) are
 * recorded as skipped in the run's detail rather than failing it.
 */

import { ident } from "./db.js";
import { evaluateRules } from "./rules.js";
import { stateFieldFor } from "./workflows.js";
import { lifecycleOf } from "./lifecycle.js";

/**
 * How many state moves one write may set off. A saga that writes a state runs
 * the entity's rules again (below), and a model whose rules move a record back
 * and forth would otherwise never stop.
 */
const MAX_STATE_WRITE_DEPTH = 8;

/** Find a saga definition by name: the table first, the model as a fallback. */
async function sagaNamed(db, model, name) {
  try {
    const row = await db.one(
      "SELECT definition FROM sys_workflow_definitions WHERE name = $1 AND kind = 'saga' AND is_active = true",
      [name]
    );
    if (row?.definition) {
      return typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;
    }
  } catch {
    /* fall through to the model */
  }
  return (model.sagas || []).find((saga) => saga.name === name) ?? null;
}

function entityNamed(model, name) {
  const wanted = String(name ?? "").trim().toLowerCase().replace(/^bus_/, "");
  return (
    model.entities.find(
      (entity) =>
        entity.name.toLowerCase() === wanted ||
        entity.tableName === `bus_${wanted}` ||
        entity.tableName === wanted
    ) ?? null
  );
}

/** A literal step value as the column will hold it. */
function literal(raw) {
  const value = String(raw ?? "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  return value;
}

async function updateEntity(db, model, triggering, record, step, context) {
  const props = step.props || {};
  const target = props.entity ? entityNamed(model, props.entity) : triggering;
  const field = String(props.field ?? "").trim();
  if (!target || !field) return { step: step.nodeId, skipped: "no entity or field" };

  const value =
    props.source && context[props.source.trim()] !== undefined
      ? context[props.source.trim()]
      : literal(props.value);

  const targetSource = props.targetSource?.trim();
  const targetField = props.targetField?.trim() || "id";
  let column = "id";
  let match;
  if (targetSource) {
    match = context[targetSource];
  } else if (target === triggering) {
    match = record.id;
  } else if (targetField !== "id") {
    column = targetField;
    match = record.id;
  }
  if (match === undefined || match === null) {
    return { step: step.nodeId, skipped: "no row to update" };
  }

  // A saga writing a record's status makes a move like anyone else: only along
  // an edge the diagram drew, from where the record is (lib/lifecycle.js), and
  // it stamps `<state>_at` as a button press does. Roles are not asked.
  const lifecycle = lifecycleOf(model, target.tableName);
  if (lifecycle?.hasMachine && lifecycle.column === field) {
    const from = lifecycle.edges.filter((edge) => edge.to === String(value)).map((edge) => edge.from);
    if (from.length === 0) {
      return { step: step.nodeId, skipped: `no drawn edge reaches "${String(value)}"` };
    }
    const stamp = `${String(value)}_at`;
    const stamps = target.attributes.some((attribute) => attribute.columnName === stamp);
    const rows = await db.query(
      `UPDATE ${ident(target.tableName)}
          SET ${ident(field)} = $1, updated_at = NOW(), version = COALESCE(version, 0) + 1
              ${stamps ? `, ${ident(stamp)} = NOW()` : ""}
        WHERE ${ident(column)} = $2 AND deleted_at IS NULL AND ${ident(field)} = ANY($3)
        RETURNING id`,
      [value, match, from]
    );
    return { step: step.nodeId, entity: target.name, field, value, rows: rows.length, ids: rows.map((row) => row.id) };
  }

  const rows = await db.query(
    `UPDATE ${ident(target.tableName)}
        SET ${ident(field)} = $1, updated_at = NOW(), version = COALESCE(version, 0) + 1
      WHERE ${ident(column)} = $2 AND deleted_at IS NULL
      RETURNING id`,
    [value, match]
  );
  return {
    step: step.nodeId,
    entity: target.name,
    field,
    value,
    rows: rows.length,
    ids: rows.map((row) => row.id),
  };
}

async function createEntity(db, model, step, context) {
  const props = step.props || {};
  const target = entityNamed(model, props.entity);
  if (!target) return { step: step.nodeId, skipped: "unknown entity" };
  let fields = {};
  try {
    fields = props.fields ? JSON.parse(props.fields) : {};
  } catch {
    return { step: step.nodeId, skipped: "fields is not JSON" };
  }
  const values = {};
  for (const [column, source] of Object.entries(fields)) {
    values[column] =
      typeof source === "string" && context[source] !== undefined ? context[source] : source;
  }
  // A record a workflow creates starts in its machine's initial state, as one
  // a person creates does, unless the step names the state itself.
  const state = await stateFieldFor(db, model, target);
  if (state?.initial && (values[state.field] === undefined || values[state.field] === null)) {
    values[state.field] = state.initial;
  }
  const created = await db.insert(target.tableName, values);
  if (props.as) context[props.as.trim()] = created?.id;
  return { step: step.nodeId, entity: target.name, created: created?.id ?? null };
}

async function deleteEntity(db, model, triggering, record, step, context) {
  const props = step.props || {};
  const target = props.entity ? entityNamed(model, props.entity) : triggering;
  if (!target) return { step: step.nodeId, skipped: "unknown entity" };
  const targetSource = props.targetSource?.trim();
  const targetField = props.targetField?.trim() || "id";
  const column = targetSource ? "id" : target === triggering ? "id" : targetField;
  const match = targetSource ? context[targetSource] : record.id;
  if (match === undefined || match === null) return { step: step.nodeId, skipped: "no row" };
  const rows = await db.query(
    `UPDATE ${ident(target.tableName)} SET deleted_at = NOW()
      WHERE ${ident(column)} = $1 AND deleted_at IS NULL RETURNING id`,
    [match]
  );
  return { step: step.nodeId, entity: target.name, deleted: rows.length };
}

/**
 * A saga that failed while its caller owns the transaction. The caller rolls
 * back — the run row dies with it — so it carries the workflow and the reason to
 * put the failure back afterwards (`recordFailedSaga`) and to tell the person.
 */
export class SagaFailure extends Error {
  constructor(workflow, reason, steps, operation) {
    super(`Workflow "${workflow}" failed: ${reason}`);
    this.name = "SagaFailure";
    this.workflow = workflow;
    this.reason = reason;
    this.steps = steps;
    this.operation = operation;
  }
}

/**
 * Put a failed run back after the transaction that held it rolled back, on the
 * caller's own connection. Never throws: Run History is a record of the failure,
 * not part of it.
 */
export async function recordFailedSaga(db, entity, record, failure, user) {
  try {
    await db.insert("sys_workflow_runs", {
      workflow_name: failure.workflow,
      entity_name: entity.name,
      record_id: record.id,
      trigger: "saga",
      status: "failed",
      detail: JSON.stringify({ operation: failure.operation ?? null, steps: failure.steps ?? [], error: failure.reason }),
      created_by: user?.id ?? null,
    });
  } catch {
    /* the move is already refused; a missing history row must not hide that */
  }
}

/** Run one saga against the record that started it. */
export async function runSaga(db, model, entity, record, saga, user, options = {}) {
  const context = { ...record };
  const results = [];
  let status = "completed";
  for (const step of saga.steps || []) {
    try {
      if (step.type === "UpdateEntity") {
        results.push(await updateEntity(db, model, entity, record, step, context));
      } else if (step.type === "CreateEntity") {
        results.push(await createEntity(db, model, step, context));
      } else if (step.type === "DeleteEntity") {
        results.push(await deleteEntity(db, model, entity, record, step, context));
      } else {
        results.push({ step: step.nodeId, skipped: `${step.type} is not run in the browser` });
      }
    } catch (error) {
      results.push({ step: step.nodeId, error: error.message });
      status = "failed";
      // The caller owns a transaction: let it roll back rather than record a
      // half-applied run that the rollback would take with it anyway.
      if (options.throwOnError) {
        throw new SagaFailure(saga.name, error.message, results, options.operation);
      }
      break;
    }
  }

  await db.insert("sys_workflow_runs", {
    workflow_name: saga.name,
    entity_name: entity.name,
    record_id: record.id,
    trigger: "saga",
    status,
    detail: JSON.stringify({ steps: results }),
    created_by: user?.id ?? null,
  });
  return { saga: saga.name, status, steps: results };
}

/**
 * Every saga a write starts: those its rules named with `trigger-workflow`,
 * and those declared `trigger: automatic` for this operation. Run after the
 * write, against the record as stored — as the NestJS stack does.
 *
 * A saga that writes an entity's state field is itself a write that rules may
 * be keyed on (`status == "paid" and …`), and a person's request is no longer
 * how a state changes, so nothing else would evaluate them. After such a step
 * the moved rows are re-read and their UPDATE rules run again; only the sagas
 * those rules start are run, as `followStateWrites` does in the NestJS rules
 * service, to a depth of MAX_STATE_WRITE_DEPTH.
 *
 * `options` is for a button press, which is a write the person's request does
 * not make but a move does:
 *
 *   bound          the operations a move runs workflows under, in order —
 *                  `TRANSITION:<EVENT>` and `ENTER:<STATE>`. A saga declared
 *                  `status: <state>` is stored as `ENTER:<STATE>`, so a plain
 *                  save (UPDATE) never selects it.
 *   skipAutomatic  the form was saved a moment ago by the same press, and the
 *                  record's update sagas ran with that save.
 *   throwOnError   the caller owns a transaction: a failing saga throws
 *                  (SagaFailure) so it rolls back, instead of being recorded.
 */
export async function runTriggeredSagas(
  db, model, entity, record, operation, notifications, user, depth = 0, options = {}
) {
  const names = new Map();
  const add = (name, boundTo) => {
    if (!names.has(name)) names.set(name, boundTo);
  };
  const automatic = () => {
    if (depth !== 0 || options.skipAutomatic) return;
    for (const saga of model.sagas || []) {
      if (saga.entity !== entity.name || saga.trigger !== "automatic") continue;
      if (saga.operation === "ALL" || saga.operation === operation) add(saga.name);
    }
  };
  const bound = () => {
    if (depth !== 0) return;
    for (const wanted of options.bound || []) {
      for (const saga of model.sagas || []) {
        if (saga.entity !== entity.name || saga.trigger !== "automatic") continue;
        if (String(saga.operation).toUpperCase() === wanted) add(saga.name, wanted);
      }
    }
  };
  const notified = () => {
    for (const item of notifications || []) {
      const action = String(item.action || "").toLowerCase();
      const name = item.workflowName || item.workflow;
      if (action.startsWith("trigger") && name) add(String(name));
    }
  };
  // A move runs the record's update sagas, then those bound to it, then the ones
  // its rules start — the order the NestJS stack keeps. A write keeps its own.
  if (options.bound) {
    automatic();
    bound();
    notified();
  } else {
    notified();
    automatic();
  }

  const runs = [];
  for (const [name, boundTo] of names) {
    const saga = await sagaNamed(db, model, name);
    if (!saga) continue;
    const run = await runSaga(db, model, entity, record, saga, user, {
      throwOnError: options.throwOnError,
      operation: boundTo ?? operation,
    });
    runs.push(run);
    runs.push(...(await followStateWrites(db, model, run, user, depth, options)));
  }
  return runs;
}

async function followStateWrites(db, model, run, user, depth, options = {}) {
  if (depth >= MAX_STATE_WRITE_DEPTH) return [];
  const runs = [];
  for (const result of run.steps) {
    if (!result.ids?.length) continue;
    const target = entityNamed(model, result.entity);
    if (!target) continue;
    const state = await stateFieldFor(db, model, target);
    if (!state || state.field !== result.field) continue;
    const rules = await db.query(
      `SELECT name, jdm_content FROM sys_rule_definitions
        WHERE entity_name = $1 AND operation IN ('UPDATE', 'ALL') AND is_active = true
        ORDER BY priority ASC`,
      [target.name]
    );
    for (const id of result.ids) {
      const row = await db.one(
        `SELECT * FROM ${ident(target.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!row) continue;
      const outcome = await evaluateRules(rules, row, {
        columns: target.attributes.map((attribute) => attribute.columnName),
      });
      runs.push(
        ...(await runTriggeredSagas(
          db, model, target, row, "UPDATE", outcome.notifications, user, depth + 1,
          { throwOnError: options.throwOnError }
        ))
      );
    }
  }
  return runs;
}
