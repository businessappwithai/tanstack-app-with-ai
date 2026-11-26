/**
 * Where a workflow is read from — the table, not the model.
 *
 * `sys_workflow_definitions` is seeded at first boot from `model.workflows`,
 * storing each workflow object whole in the `definition` column. Until now it
 * was written there and read by three listing endpoints and nothing else: every
 * *behavioural* use of a workflow — which transitions a record is offered, and
 * whether a status change is recorded as modelled — read `model.workflows`
 * instead, the copy compiled into the bundle.
 *
 * That split is fine while nothing can change either. It stops being fine the
 * moment the admin screen can edit a workflow, because the edit lands in the
 * table and the application keeps behaving from the model: a definition that is
 * "seeded, visible in the admin screen, drawn by the viewer, and inert" — the
 * failure this codebase has already documented once, in the dance-studio
 * model's sixteen `%%action` lines.
 *
 * So the table is the source of truth, the way `sys_rule_definitions` already
 * is for rules (`bus.routes.js` enforces from that table, not from
 * `model.rules`) and the way the Application Dictionary is for screens. The
 * model seeds it; after that, what the database says is what the application
 * does.
 *
 * **The fallback to the model is deliberate and narrow.** An application
 * generated before this table was seeded, or one whose seed was interrupted,
 * would otherwise lose its state machines entirely rather than degrade — and
 * losing them silently disables the transition UI on every record. Falling back
 * keeps such an application behaving exactly as it did before.
 */

/**
 * Every workflow for one entity, newest definition wins on a name collision.
 *
 * Parsed defensively: `definition` is JSONB the administrator can now write, and
 * a row that will not parse should cost that one workflow rather than every
 * screen that asks for one.
 */
export async function workflowsForEntity(db, model, entityName) {
  let rows = [];
  try {
    rows = await db.select("sys_workflow_definitions", {
      where: { entity_name: entityName, is_active: true },
      orderBy: "name",
    });
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return (model.workflows || []).filter((item) => item.entity === entityName);
  }

  const parsed = [];
  for (const row of rows) {
    const definition = parseDefinition(row);
    if (definition) parsed.push(definition);
  }
  /* Every row failing to parse is not the same as no rows: the model is still
     the better answer than nothing. */
  if (parsed.length === 0) {
    return (model.workflows || []).filter((item) => item.entity === entityName);
  }
  return parsed;
}

/**
 * The one state machine an entity moves on, or null.
 *
 * A `kind: saga` definition is a multi-step process, not a lifecycle, and asking
 * it for `transitions` gets an empty list — so the state machine is picked by
 * kind rather than by being first.
 */
export async function stateMachineFor(db, model, entityName) {
  const workflows = await workflowsForEntity(db, model, entityName);
  return (
    workflows.find((item) => (item.kind ?? "state") === "state" && Array.isArray(item.transitions)) ??
    null
  );
}

function parseDefinition(row) {
  const raw = row.definition;
  if (!raw) return null;
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  /* The row's own columns win over the stored blob for the three things the
     row also carries: an administrator who renames a workflow edits the column,
     and the blob it was seeded from would otherwise keep the old name. */
  return {
    ...value,
    name: row.name ?? value.name,
    entity: row.entity_name ?? value.entity,
    kind: row.kind ?? value.kind ?? "state",
  };
}

/**
 * The column an entity's state machine drives, and the state a new record
 * starts in — or null when the entity has no state machine.
 *
 * `status`, else `state`, else `stage`: the same order `language/state-field.ts`
 * states for the checker, the generator and the NestJS stack. That column is
 * system-managed. No person writes it: the bus routes drop it on create (the
 * record starts in `initial`) and refuse a change to it on update, and only the
 * application's background workflows — the saga executor in `sagas.js`, the
 * rules that start it, the hooks — move it. The form shows it read-only in the
 * record's header and the list grid always shows it.
 */
export const STATE_FIELD_CANDIDATES = ["status", "state", "stage"];

export async function stateFieldFor(db, model, entity) {
  const machine = await stateMachineFor(db, model, entity.name);
  if (!machine) return null;
  const field = STATE_FIELD_CANDIDATES.find((candidate) =>
    entity.attributes.some((attribute) => attribute.columnName === candidate)
  );
  if (!field) return null;
  const initial =
    machine.initial ??
    (machine.transitions || []).find((transition) => transition.from === "[*]")?.to ??
    null;
  return { field, initial, machine };
}

/** `details.code` of the refusal a person's write to a state field receives. */
export const STATE_FIELD_REFUSAL_CODE = "STATE_FIELD_SYSTEM_MANAGED";
