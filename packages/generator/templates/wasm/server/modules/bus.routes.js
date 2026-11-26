/**
 * Business entity CRUD — the route every generated screen is built on.
 *
 * Nothing here is per-entity. The dictionary already says which tables exist,
 * which columns they have, which are mandatory and which reference something
 * else, so one set of handlers keyed on `:entity` serves an application with
 * three tables and one with three hundred. That is the whole point of a
 * dictionary-driven design, and it is also what makes generation cheap: adding
 * an entity to the model adds rows, not routes.
 *
 * The write path runs in a fixed order — resolve, guard, hook, rule, persist,
 * audit — and every step can refuse. The order matters: rules see the record
 * after before-hooks have stamped their fields, because a rule that fires on a
 * value a hook was about to compute would decide on data that never existed.
 */

import { Router } from "../lib/router.js";
import { badRequest, errorResponse, json, notFound, readJson } from "../lib/http.js";
import { ident } from "../lib/db.js";
import { checkOperationAccess, requireUser } from "../lib/guards.js";
import { STATE_FIELD_REFUSAL_CODE, stateFieldFor, stateMachineFor } from "../lib/workflows.js";
import { recordFailedSaga, runTriggeredSagas, SagaFailure } from "../lib/sagas.js";
import { runHooks } from "../lib/hooks.js";
import { evaluateRules } from "../lib/rules.js";
import { logicViolations } from "../lib/field-logic.js";
import { recordAudit } from "./audit.routes.js";
import { labelsForRows } from "../lib/labels.js";
import { toRouteName } from "../lib/naming.js";
import { findMove, isLocked, lifecycleOf, mayPress, movesFrom, phaseOf } from "../lib/lifecycle.js";

/** Columns every generated table carries; never editable by a client. */
const MANAGED = new Set([
  "id",
  "version",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "deleted_at",
  "deleted_by",
]);

/**
 * Resolve a URL segment to an entity.
 *
 * Accepts the route form (`sales-order`), the table name (`bus_sales_order`)
 * and the model's own spelling (`SalesOrder`), because all three appear: the UI
 * links with the first, the dictionary stores the second, and rules and
 * workflows are written against the third. Anything that resolves to nothing is
 * a 404 before a table name is ever concatenated into SQL.
 */
export function resolveEntity(model, segment) {
  const wanted = String(segment ?? "").toLowerCase();
  return (
    model.entities.find(
      (entity) =>
        entity.routeName === wanted ||
        entity.tableName === wanted ||
        entity.name.toLowerCase() === wanted ||
        toRouteName(entity.name) === wanted
    ) || null
  );
}

function entityOr404(model, segment) {
  const entity = resolveEntity(model, segment);
  if (!entity) throw notFound(`No entity "${segment}" in this model`);
  return entity;
}

/** Metadata for one entity, assembled from the dictionary rows. */
async function entityMetadata(db, entity, model) {
  /* The state field is system-managed (lib/workflows.js stateFieldFor): never
     an input on the form, always a column of the list, whatever the field rows
     say — an administrator's toggle can neither make it editable nor hide it. */
  const state = model ? await stateFieldFor(db, model, entity) : null;
  const table = await db.one("SELECT * FROM sys_table WHERE table_name = $1", [entity.tableName]);
  if (!table) throw notFound(`${entity.tableName} is not in the dictionary`);

  const columns = await db.query(
    `SELECT c.sys_column_id, c.column_name, c.sys_reference_id, c.field_length, c.default_value,
            c.ref_table_name, c.is_key, c.is_identifier, c.is_selection_column, c.is_parent,
            f.sys_field_id, f.name, COALESCE(f.description, c.description) AS description,
            f.is_displayed, f.is_displayed_grid,
            f.is_read_only, f.is_mandatory, f.is_updateable, f.is_insertable,
            f.seq_no, f.seq_no_grid, f.field_type, f.sys_field_group_id,
            f.is_same_line, f.column_span,
            f.display_logic,
            COALESCE(f.read_only_logic, c.read_only_logic) AS read_only_logic,
            COALESCE(f.mandatory_logic, c.mandatory_logic) AS mandatory_logic,
            g.name AS group_name, g.description AS group_description,
            g.columns AS group_columns, g.is_collapsed_by_default AS group_collapsed,
            g.seq_no AS group_seq_no
       FROM sys_column c
       JOIN sys_table t ON t.sys_table_id = c.sys_table_id
       LEFT JOIN sys_tab tb ON tb.sys_table_id = t.sys_table_id
       LEFT JOIN sys_field f ON f.sys_column_id = c.sys_column_id AND f.sys_tab_id = tb.sys_tab_id
       LEFT JOIN sys_field_group g ON g.sys_field_group_id = f.sys_field_group_id
      WHERE t.table_name = $1
      ORDER BY COALESCE(g.seq_no, 0), COALESCE(f.seq_no, c.seq_no)`,
    [entity.tableName]
  );

  const window = table.sys_window_id
    ? await db.one("SELECT sys_window_id, name FROM sys_window WHERE sys_window_id = $1", [
        table.sys_window_id,
      ])
    : null;

  return {
    table: {
      sys_table_id: table.sys_table_id,
      table_name: table.table_name,
      name: table.name,
      description: table.description,
      state_field: state?.field ?? null,
    },
    entity: { name: entity.name, route: entity.routeName },
    columns: columns.map((column) => {
      const isState = state?.field === column.column_name;
      return {
      sys_field_id: column.sys_field_id,
      name: column.name || column.column_name,
      column_name: column.column_name,
      /* `%%field <E>.<c> help:` — sys_field carries it per screen and
         sys_column per model, so the field's own text wins and the column's is
         the fallback. The form renders it under the control. */
      description: column.description ?? null,
      sys_reference_id: column.sys_reference_id,
      is_mandatory: isState ? false : (column.is_mandatory ?? false),
      is_updateable: isState ? false : column.is_updateable !== false,
      is_insertable: isState ? false : column.is_insertable !== false,
      is_read_only: isState ? true : (column.is_read_only ?? false),
      is_displayed: isState ? false : column.is_displayed !== false,
      is_displayed_grid: isState ? true : column.is_displayed_grid !== false,
      is_state_field: isState,
      is_key: column.is_key ?? false,
      /* The column tying a detail row to its master, from
         `%%entity <Child> parent: <Parent>`. Projected so the dictionary screen
         can show what the tab links on rather than leaving it a mystery. */
      is_parent: column.is_parent ?? false,
      field_length: column.field_length,
      default_value: column.default_value,
      ref_table_name: column.ref_table_name,
      field_type: column.field_type,
      seq_no: column.seq_no ?? 0,
      seq_no_grid: column.seq_no_grid ?? 0,
      /* `%%section`: the heading, the sentence under it, the grid it draws
         (2 columns), and whether this field spans a row of its own. */
      group_name: column.group_name,
      group_description: column.group_description ?? null,
      group_columns: column.group_columns ?? null,
      group_collapsed: column.group_collapsed ?? false,
      is_same_line: column.is_same_line ?? false,
      col_span: column.column_span ?? null,
      /* Field logic (Compiere's Display, Read Only and Mandatory Logic). The
         field's own wins over the column's; the state field carries none, as
         it is never an input. The form evaluates these as the record is
         edited, and `enforceFieldLogic` below on every write. */
      display_logic: isState ? null : (column.display_logic ?? null),
      read_only_logic: isState ? null : (column.read_only_logic ?? null),
      mandatory_logic: isState ? null : (column.mandatory_logic ?? null),
      };
    }),
    window: window ? { sys_window_id: window.sys_window_id, name: window.name } : undefined,
  };
}

/**
 * One `filter.<column>=<operator>:<value>` clause, or null if it names nothing.
 *
 * The operator set is the NestJS controller's, deliberately: the advanced
 * search sends the same query string to either stack, and a model that filters
 * one way in the browser and another way deployed would make the browser
 * application a demonstration of something else.
 *
 * Text operators compare `::text` so a uuid or a number still matches
 * `contains`; the rest coerce through the column's own type, so `gt` on a date
 * compares dates rather than strings. Everything goes through a bound
 * parameter — `ident()` is the only thing interpolated, and it only ever
 * receives a column name the model declared.
 */
function filterCondition(entity, column, raw, parameters) {
  const attribute = entity.attributes.find((item) => item.columnName === column);
  if (!attribute) return null;

  const separator = String(raw).indexOf(":");
  const operator = separator === -1 ? "equals" : String(raw).slice(0, separator);
  const value = separator === -1 ? String(raw) : String(raw).slice(separator + 1);
  if (value === "") return null;

  const bind = (bound) => {
    parameters.push(bound);
    return parameters.length;
  };

  switch (operator) {
    case "contains":
      return `${ident(column)}::text ILIKE $${bind(`%${value}%`)}`;
    case "startsWith":
      return `${ident(column)}::text ILIKE $${bind(`${value}%`)}`;
    case "endsWith":
      return `${ident(column)}::text ILIKE $${bind(`%${value}`)}`;
    case "gt":
      return `${ident(column)} > $${bind(coerce(value, attribute))}`;
    case "gte":
      return `${ident(column)} >= $${bind(coerce(value, attribute))}`;
    case "lt":
      return `${ident(column)} < $${bind(coerce(value, attribute))}`;
    case "lte":
      return `${ident(column)} <= $${bind(coerce(value, attribute))}`;
    case "equals":
    case "eq":
    default:
      return `${ident(column)} = $${bind(coerce(value, attribute))}`;
  }
}

/** Coerce a submitted value to what the column can actually store. */
function coerce(value, attribute) {
  if (value === "" || value === undefined) return attribute.required ? value : null;
  if (value === null) return null;
  switch (attribute.type) {
    case "integer":
      return Number.parseInt(value, 10);
    case "decimal":
    case "number":
      return Number(value);
    case "boolean":
      return value === true || value === "true" || value === 1 || value === "1";
    case "json":
      return typeof value === "string" ? safeJson(value) : value;
    default:
      return value;
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Keep only real columns, coerced. Unknown keys are dropped, not rejected. */
function sanitize(entity, body) {
  const values = {};
  for (const attribute of entity.attributes) {
    const column = attribute.columnName;
    if (MANAGED.has(column)) continue;
    if (!Object.prototype.hasOwnProperty.call(body, column)) continue;
    values[column] = coerce(body[column], attribute);
  }
  return values;
}

function validate(entity, values, mode) {
  const errors = [];
  for (const attribute of entity.attributes) {
    if (MANAGED.has(attribute.columnName)) continue;
    const present = Object.prototype.hasOwnProperty.call(values, attribute.columnName);
    const value = values[attribute.columnName];
    if (attribute.required && (mode === "create" ? !present || isBlank(value) : present && isBlank(value))) {
      errors.push(`${attribute.displayName || attribute.columnName} is required`);
    }
    if (present && attribute.maxLength && typeof value === "string" && value.length > attribute.maxLength) {
      errors.push(`${attribute.displayName} must be ${attribute.maxLength} characters or fewer`);
    }
    if (present && !isBlank(value) && (attribute.type === "integer" || attribute.type === "decimal")) {
      if (Number.isNaN(Number(value))) errors.push(`${attribute.displayName} must be a number`);
    }
  }
  if (errors.length) throw badRequest("Validation failed", errors);
}

const isBlank = (value) => value == null || String(value).trim() === "";

/**
 * Field logic, enforced. The form hides, locks and requires fields as the
 * record is edited, but the form is a convenience and this is the control —
 * the same refusals the NestJS stack gives (lib/field-logic.js
 * `logicViolations`): a displayed field whose mandatory logic holds for the
 * record as it will be saved must have a value, and a field whose read-only
 * logic holds for the record as it is stored cannot be changed.
 *
 * Read from the dictionary rows rather than from model.json, so a condition an
 * administrator edits under Windows, Tabs & Fields applies on the next write.
 */
async function enforceFieldLogic(db, entity, model, record, changes, stored) {
  const metadata = await entityMetadata(db, entity, model);
  const fields = metadata.columns.filter(
    (column) => column.mandatory_logic || column.read_only_logic
  );
  if (!fields.length) return;
  const errors = logicViolations(fields, record, changes, stored);
  if (errors.length) throw badRequest("Validation failed", errors);
}

/**
 * The column a state machine moves, when the entity has one.
 *
 * Takes the workflow rather than the model: the definitions live in
 * `sys_workflow_definitions` and an administrator can now edit them, so an
 * entity's machine is whatever the table currently says it is. Reading
 * `model.workflows` here would mean an entity given a machine after generation
 * never had its status changes recorded, and one whose machine was deleted went
 * on being treated as having one.
 */
function statusColumn(entity, workflow) {
  if (!workflow) return null;
  const candidates = ["status", "state", "stage"];
  return entity.attributes.find((attribute) => candidates.includes(attribute.columnName))?.columnName ?? null;
}

async function rulesFor(db, entity, operation) {
  return db.query(
    `SELECT name, jdm_content FROM sys_rule_definitions
      WHERE entity_name = $1 AND operation IN ($2, 'ALL') AND is_active = true
      ORDER BY priority ASC`,
    [entity.name, operation]
  );
}

/**
 * The record version an `If-Match` header names: `"3"`, `"v3"`, `3` or a weak
 * `W/"3"`. Anything else is refused with 400 rather than read as `NaN`, which
 * would never equal a version and turn every save into a false conflict.
 */
function parseIfMatch(header) {
  if (header == null || header.trim() === "" || header.trim() === "*") return undefined;
  const match = /^(?:W\/)?"?v?(\d+)"?$/i.exec(header.trim());
  if (!match) throw badRequest(`If-Match must name a record version, such as "3"; got ${header}`);
  return Number(match[1]);
}

/**
 * A record's version as an ETag — what a client sends back as `If-Match` to
 * save against the version it read.
 */
function etagHeader(row) {
  return row?.version != null ? { ETag: `"${row.version}"` } : {};
}

/**
 * The 409 a stale save gets — the same body the NestJS stack sends, so one
 * form can key its reload-or-overwrite dialog on `details.code`. The record is
 * not included: the form re-reads it through GET, which applies field access.
 */
function versionConflict(entity, id, expectedVersion, currentVersion) {
  return json(
    {
      statusCode: 409,
      error: "Conflict",
      message: "This record was changed by someone else after you opened it.",
      details: { code: "VERSION_CONFLICT", entity: entity.name, id, expectedVersion, currentVersion },
    },
    { status: 409 }
  );
}

export function busRoutes(model) {
  const router = new Router();

  router.get("/:entity/meta", async (_request, { db, params }) =>
    json(await entityMetadata(db, entityOr404(model, params.entity), model))
  );

  router.get("/:entity/fields/form", async (_request, { db, params, query }) => {
    const metadata = await entityMetadata(db, entityOr404(model, params.entity), model);
    const includeHidden = query.get("includeHidden") === "true";
    return json(
      metadata.columns
        .filter((column) => includeHidden || column.is_displayed)
        .sort((a, b) => a.seq_no - b.seq_no)
    );
  });

  router.get("/:entity/fields/grid", async (_request, { db, params, query }) => {
    const metadata = await entityMetadata(db, entityOr404(model, params.entity), model);
    const includeHidden = query.get("includeHidden") === "true";
    return json(
      metadata.columns
        .filter((column) => includeHidden || column.is_displayed_grid)
        .sort((a, b) => a.seq_no_grid - b.seq_no_grid)
    );
  });

  router.get("/:entity", async (_request, { db, params, query, user }) => {
    const entity = entityOr404(model, params.entity);
    await checkOperationAccess(db, user, entity.tableName, "read");

    const page = Math.max(1, Number(query.get("page") || 1));
    const limit = Math.min(500, Math.max(1, Number(query.get("limit") || 25)));
    const search = (query.get("search") || "").trim();
    const sort = query.get("sort");
    const order = String(query.get("order") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const conditions = ["deleted_at IS NULL"];
    const parameters = [];

    // Equality filters arrive as bare query keys naming a column — the grid's
    // column filters and every "records of this parent" link use them.
    //
    // `filter.<column>=<operator>:<value>` is the richer form the advanced
    // search sends, and it is the same contract the NestJS stack's controller
    // parses: one stack's model must not search differently from the other's.
    for (const [key, value] of query.entries()) {
      if (["page", "limit", "search", "sort", "order"].includes(key)) continue;

      if (key.startsWith("filter.")) {
        const condition = filterCondition(entity, key.slice("filter.".length), value, parameters);
        if (condition) conditions.push(condition);
        continue;
      }

      const attribute = entity.attributes.find((item) => item.columnName === key);
      if (!attribute) continue;
      parameters.push(coerce(value, attribute));
      conditions.push(`${ident(key)} = $${parameters.length}`);
    }

    if (search) {
      const searchable = entity.attributes.filter(
        (attribute) => attribute.type === "string" || attribute.type === "text"
      );
      if (searchable.length) {
        parameters.push(`%${search}%`);
        const index = parameters.length;
        conditions.push(
          `(${searchable.map((attribute) => `${ident(attribute.columnName)}::text ILIKE $${index}`).join(" OR ")})`
        );
      }
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const sortColumn = entity.attributes.find((attribute) => attribute.columnName === sort)
      ? sort
      : "created_at";

    const total = await db.value(
      `SELECT COUNT(*)::int FROM ${ident(entity.tableName)} ${where}`,
      parameters
    );
    const data = await db.query(
      `SELECT * FROM ${ident(entity.tableName)} ${where}
        ORDER BY ${ident(sortColumn)} ${order}
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      parameters
    );

    /* The rows carry foreign keys, which is what editing and filtering need,
       and a uuid is not what a reader came to see. The names travel alongside
       rather than replacing the ids, so the grid can show one and act on the
       other. */
    const labels = await labelsForRows(db, entity, data);

    return json({
      data,
      labels,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.get("/:entity/:id", async (_request, { db, params, user }) => {
    const entity = entityOr404(model, params.entity);
    await checkOperationAccess(db, user, entity.tableName, "read");
    const row = await db.one(
      `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
      [params.id]
    );
    if (!row) throw notFound(`No ${entity.name} with id ${params.id}`);
    return json(row, { headers: etagHeader(row) });
  });

  router.post("/:entity", async (request, { db, params, user }) => {
    const entity = entityOr404(model, params.entity);
    requireUser(user);
    await checkOperationAccess(db, user, entity.tableName, "create");

    const body = await readJson(request);
    let values = sanitize(entity, body);

    // A new record starts in its machine's initial state, whatever the request
    // said: the state is the application's to set, never a person's. A hook
    // below may still set it, and the sagas the write starts move it on.
    const state = await stateFieldFor(db, model, entity);
    if (state) {
      delete values[state.field];
      if (state.initial) values[state.field] = state.initial;
    }

    const before = await runHooks(model.hooks, "beforeCreate", entity.name, values);
    if (before.failures.length) throw badRequest("A lifecycle hook refused the write", before.failures);
    values = before.record;

    validate(entity, values, "create");
    await enforceFieldLogic(db, entity, model, values, values, null);

    const outcome = await evaluateRules(await rulesFor(db, entity, "CREATE"), values, {
      columns: entity.attributes.map((attribute) => attribute.columnName),
    });
    if (outcome.violations.length) {
      return json(
        { statusCode: 422, message: "A business rule refused this record", violations: outcome.violations },
        { status: 422 }
      );
    }
    Object.assign(values, applicableMutations(entity, outcome.mutations));

    values.created_by = user.id;
    values.updated_by = user.id;

    const created = await db.insert(entity.tableName, values);
    const after = await runHooks(model.hooks, "afterCreate", entity.name, created);
    const runs = await runTriggeredSagas(
      db, model, entity, created, "CREATE", outcome.notifications, user
    );

    await recordAudit(db, {
      user,
      action: "CREATE",
      entityType: entity.tableName,
      entityId: created.id,
      after: created,
    });

    const stored = runs.length
      ? (await db.one(`SELECT * FROM ${ident(entity.tableName)} WHERE id = $1`, [created.id])) ?? created
      : created;
    return json(
      { ...stored, _hooks: [...before.log, ...after.log], _notifications: outcome.notifications, _workflows: runs },
      { status: 201 }
    );
  });

  const write = async (request, { db, params, user }) => {
    const entity = entityOr404(model, params.entity);
    requireUser(user);
    await checkOperationAccess(db, user, entity.tableName, "update");

    const current = await db.one(
      `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
      [params.id]
    );
    if (!current) throw notFound(`No ${entity.name} with id ${params.id}`);

    // Optimistic locking, as the NestJS stack does it: the form sends the
    // version it opened the record at, and a save against a version someone
    // has since moved past is refused before anything else runs.
    const expectedVersion = parseIfMatch(request.headers.get("if-match"));
    if (expectedVersion !== undefined && Number(current.version ?? 0) !== expectedVersion) {
      return versionConflict(entity, params.id, expectedVersion, Number(current.version ?? 0));
    }
    // The end of a flow is Final and locked; Reopen is the way back.
    const locked = lockedResponse(model, entity, current);
    if (locked) return locked;

    const body = await readJson(request);
    let values = sanitize(entity, body);

    // The state is changed only by background workflows. The value the record
    // already holds is dropped, so a form sending the whole record back still
    // saves; any other value is refused, for every person, administrator
    // included — the same answer the NestJS stack gives.
    const state = await stateFieldFor(db, model, entity);
    if (state && Object.prototype.hasOwnProperty.call(values, state.field)) {
      if (String(values[state.field] ?? "") === String(current[state.field] ?? "")) {
        delete values[state.field];
      } else {
        return json(
          {
            statusCode: 403,
            message:
              `"${state.field}" is changed only by the record's moves, never through a form. ` +
              "Use one of the record's action buttons (POST …/transition).",
            details: {
              code: STATE_FIELD_REFUSAL_CODE,
              entity: entity.tableName,
              field: state.field,
              current: current[state.field] ?? null,
            },
          },
          { status: 403 }
        );
      }
    }

    const before = await runHooks(model.hooks, "beforeUpdate", entity.name, values, { previous: current });
    if (before.failures.length) throw badRequest("A lifecycle hook refused the write", before.failures);
    values = before.record;

    validate(entity, values, "update");

    // The rule sees the record it would become, not the fragment submitted:
    // `status == 'draft'` has to be answerable when the write only sets a title.
    const merged = { ...current, ...values };
    await enforceFieldLogic(db, entity, model, merged, values, current);
    const outcome = await evaluateRules(await rulesFor(db, entity, "UPDATE"), merged, {
      columns: entity.attributes.map((attribute) => attribute.columnName),
    });
    if (outcome.violations.length) {
      return json(
        { statusCode: 422, message: "A business rule refused this change", violations: outcome.violations },
        { status: 422 }
      );
    }
    Object.assign(values, applicableMutations(entity, outcome.mutations));

    values.updated_by = user.id;
    values.updated_at = new Date().toISOString();
    values.version = (current.version ?? 1) + 1;

    // Conditioned on the version read above. Requests share one PGlite and
    // interleave at every await, so two saves can both pass the check before
    // either writes; this makes the second one match no row instead of
    // replacing the first.
    const updated = await db.update(entity.tableName, values, {
      id: params.id,
      version: current.version ?? null,
    });
    if (!updated) {
      const now = await db.one(`SELECT version FROM ${ident(entity.tableName)} WHERE id = $1`, [params.id]);
      return versionConflict(entity, params.id, expectedVersion ?? Number(current.version ?? 0), Number(now?.version ?? 0));
    }
    const after = await runHooks(model.hooks, "afterUpdate", entity.name, updated, { previous: current });

    await recordWorkflowRun(db, model, entity, current, updated, user);
    const runs = await runTriggeredSagas(
      db, model, entity, updated, "UPDATE", outcome.notifications, user
    );
    const stored = runs.length
      ? (await db.one(`SELECT * FROM ${ident(entity.tableName)} WHERE id = $1`, [params.id])) ?? updated
      : updated;
    await recordAudit(db, {
      user,
      action: "UPDATE",
      entityType: entity.tableName,
      entityId: params.id,
      before: current,
      after: updated,
    });

    return json(
      { ...stored, _hooks: [...before.log, ...after.log], _notifications: outcome.notifications, _workflows: runs },
      { headers: etagHeader(stored) }
    );
  };

  router.put("/:entity/:id", write);
  router.patch("/:entity/:id", write);

  router.delete("/:entity/:id", async (_request, { db, params, user }) => {
    const entity = entityOr404(model, params.entity);
    requireUser(user);
    await checkOperationAccess(db, user, entity.tableName, "delete");

    const current = await db.one(
      `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
      [params.id]
    );
    if (!current) throw notFound(`No ${entity.name} with id ${params.id}`);
    const locked = lockedResponse(model, entity, current);
    if (locked) return locked;

    const before = await runHooks(model.hooks, "beforeDelete", entity.name, current);
    if (before.failures.length) throw badRequest("A lifecycle hook refused the delete", before.failures);

    const outcome = await evaluateRules(await rulesFor(db, entity, "DELETE"), current, {
      columns: entity.attributes.map((attribute) => attribute.columnName),
    });
    if (outcome.violations.length) {
      return json(
        { statusCode: 422, message: "A business rule refused this delete", violations: outcome.violations },
        { status: 422 }
      );
    }

    // Soft delete: the audit trail refers to rows by id, and a hard delete
    // would leave the trail pointing at nothing.
    await db.update(
      entity.tableName,
      { deleted_at: new Date().toISOString(), deleted_by: user.id },
      { id: params.id }
    );
    await runHooks(model.hooks, "afterDelete", entity.name, current);
    await recordAudit(db, {
      user,
      action: "DELETE",
      entityType: entity.tableName,
      entityId: params.id,
      before: current,
    });

    return json({ success: true, id: params.id });
  });

  /**
   * The record's action buttons for this person, from where it is — the moves
   * of its flow they may press, and Reopen at the end of it (lib/lifecycle.js).
   */
  router.get("/:entity/:id/actions", async (_request, { db, params, user }) => {
    const entity = entityOr404(model, params.entity);
    await checkOperationAccess(db, user, entity.tableName, "read");
    const lifecycle = lifecycleOf(model, entity.tableName);
    if (!lifecycle?.hasMachine) return json([]);
    const record = await db.one(
      `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
      [params.id]
    );
    if (!record) throw notFound(`No ${entity.name} with id ${params.id}`);
    const mayUpdate = () => updateAllowed(db, user, entity.tableName);
    const actions = [];
    for (const move of movesFrom(lifecycle, record[lifecycle.column])) {
      const decision = await mayPress(user, model, entity.tableName, move, mayUpdate);
      if (!decision.allowed) continue;
      actions.push({
        event: move.event,
        to: move.to,
        label: move.label,
        kind: move.kind,
        restricted: decision.roles.length > 0,
        roles: decision.roles,
      });
    }
    return json(actions);
  });

  /**
   * Press a move: `{ event }` or `{ to }`, with the version the record was read
   * at as If-Match. The edge, the role and the record's rules are judged, then
   * the state is written with its `<state>_at`, and the sagas the move starts
   * run — the same contract as the NestJS stack's POST …/transition.
   *
   * With `data` — the form as it stands — the press is two transactions. The
   * first saves the form, the record staying in the status it is in (the same
   * handler a PATCH reaches, so the same rules and field logic judge it). The
   * second is the move: the sagas bound to the status it reaches (`status:
   * <state>`, stored `ENTER:<STATE>`) run in it, and the status is written only
   * if every one succeeds. A saga that fails undoes the move alone: the typing
   * stays saved, the status stays where it was, and the refusal says so
   * (`details.phase: "workflow"`, the new `details.version`).
   */
  router.post("/:entity/:id/transition", async (request, { db, params, user }) => {
    const entity = entityOr404(model, params.entity);
    requireUser(user);
    await checkOperationAccess(db, user, entity.tableName, "read");
    const lifecycle = lifecycleOf(model, entity.tableName);
    if (!lifecycle?.hasMachine) throw notFound(`${entity.name} has no status flow to move along`);

    let current = await db.one(
      `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
      [params.id]
    );
    if (!current) throw notFound(`No ${entity.name} with id ${params.id}`);

    let expectedVersion = parseIfMatch(request.headers.get("if-match"));
    if (expectedVersion === undefined) {
      return json(
        {
          statusCode: 428,
          message: "A move needs the version the record was read at, as If-Match.",
          details: { code: "PRECONDITION_REQUIRED" },
        },
        { status: 428 }
      );
    }

    const body = await readJson(request);

    // Transaction one: save the form in the status the record is in. It commits
    // before the move starts, so a failing saga cannot take it back.
    let savedFirst = false;
    if (body?.data && typeof body.data === "object" && Object.keys(body.data).length > 0) {
      let saved;
      try {
        saved = await write(
          new Request(request.url, {
            method: "PATCH",
            headers: { "content-type": "application/json", "if-match": `"${expectedVersion}"` },
            body: JSON.stringify(body.data),
          }),
          { db, params, user }
        );
      } catch (error) {
        // A save the form's own PATCH would refuse (validation, a hook) is refused the same way.
        return withPhase(errorResponse(error, "PATCH"), "save");
      }
      if (saved.status >= 400) return withPhase(saved, "save");
      current = await db.one(
        `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
        [params.id]
      );
      expectedVersion = Number(current.version ?? 0);
      savedFirst = true;
    }
    if (Number(current.version ?? 0) !== expectedVersion) {
      return versionConflict(entity, params.id, expectedVersion, Number(current.version ?? 0));
    }

    const from = current[lifecycle.column] == null ? null : String(current[lifecycle.column]);
    const move = findMove(lifecycle, from, { event: body?.event, to: body?.to });
    if (!move) {
      const offered = movesFrom(lifecycle, from).map((item) => item.event || item.to);
      return afterSave(
        json(
          {
            statusCode: 409,
            message:
              `"${body?.event ?? body?.to ?? ""}" is not a move of this record from "${from ?? "nothing"}". ` +
              (offered.length ? `Its moves are: ${offered.join(", ")}.` : "It has no moves from here."),
            details: { code: "INVALID_TRANSITION", entity: entity.tableName, id: params.id, from, offered },
          },
          { status: 409 }
        )
      );
    }

    const decision = await mayPress(user, model, entity.tableName, move, () =>
      updateAllowed(db, user, entity.tableName)
    );
    if (!decision.allowed) {
      return afterSave(
        json(
          {
            statusCode: 403,
            message:
              move.kind === "reopen" && decision.roles.length === 0
                ? "Only an administrator can reopen this record."
                : `"${move.label}" can be pressed by: ${decision.roles.join(", ")}.`,
            details: { code: "TRANSITION_FORBIDDEN", entity: entity.tableName, id: params.id, roles: decision.roles },
          },
          { status: 403 }
        )
      );
    }

    /** A refusal after the save says the save stands, and at which version. */
    function afterSave(response) {
      return savedFirst
        ? withPhase(response, "workflow", { saved: true, version: Number(current.version ?? 0) })
        : response;
    }

    // Transaction two. Everything the move does is one unit: a saga that fails
    // throws, the transaction rolls back, and the record is as the save left it.
    try {
      return await db.transaction(async (db) => {
        const now = new Date().toISOString();
        const values = {
          [lifecycle.column]: move.to,
          updated_by: user.id,
          updated_at: now,
          version: (current.version ?? 1) + 1,
        };
        const stamp = `${move.to}_at`;
        if (entity.attributes.some((attribute) => attribute.columnName === stamp)) values[stamp] = now;

        // Refusing rules hold on a move as on a save, judged on the record as it
        // will be: "a resolved case needs its notes".
        const merged = { ...current, ...values };
        const outcome = await evaluateRules(await rulesFor(db, entity, "UPDATE"), merged, {
          columns: entity.attributes.map((attribute) => attribute.columnName),
        });
        if (outcome.violations.length) {
          return afterSave(
            json(
              { statusCode: 422, message: "A business rule refused this move", violations: outcome.violations },
              { status: 422 }
            )
          );
        }

        const updated = await db.update(entity.tableName, values, {
          id: params.id,
          version: current.version ?? null,
        });
        if (!updated) {
          const latest = await db.one(`SELECT version FROM ${ident(entity.tableName)} WHERE id = $1`, [params.id]);
          return versionConflict(entity, params.id, expectedVersion, Number(latest?.version ?? 0));
        }
        await recordWorkflowRun(db, model, entity, current, updated, user);
        const runs = await runTriggeredSagas(db, model, entity, updated, "UPDATE", outcome.notifications, user, 0, {
          bound: [move.event ? `TRANSITION:${String(move.event).toUpperCase()}` : null, `ENTER:${String(move.to).toUpperCase()}`].filter(Boolean),
          skipAutomatic: savedFirst,
          throwOnError: true,
        });
        const stored = runs.length
          ? (await db.one(`SELECT * FROM ${ident(entity.tableName)} WHERE id = $1`, [params.id])) ?? updated
          : updated;
        await recordAudit(db, {
          user,
          action: "UPDATE",
          entityType: entity.tableName,
          entityId: params.id,
          before: current,
          after: stored,
        });
        return json(
          {
            ...stored,
            lifecycle: {
              column: lifecycle.column,
              from,
              to: move.to,
              phase: phaseOf(lifecycle, move.to),
              event: move.event,
            },
            _workflows: runs,
          },
          { headers: etagHeader(stored) }
        );
      });
    } catch (error) {
      if (!(error instanceof SagaFailure)) throw error;
      // The rollback took the failed run with it; put it back for Run History.
      await recordFailedSaga(db, entity, current, error, user);
      // Write the failure reason so the form can show it beside the action buttons.
      try {
        await db.query(
          `UPDATE ${ident(entity.tableName)} SET doc_status_message = $1 WHERE id = $2`,
          [error.reason ?? error.message, params.id]
        );
      } catch (_) { /* best effort */ }
      return json(
        {
          statusCode: 422,
          message: `"${move.label}" did not go through: ${error.message}. The record is still "${from}".`,
          error: "Unprocessable Entity",
          details: {
            code: "WORKFLOW_FAILED",
            entity: entity.tableName,
            id: params.id,
            from,
            to: move.to,
            workflow: error.workflow,
            reason: error.reason,
            ...(savedFirst ? { phase: "workflow", saved: true, version: Number(current.version ?? 0) } : {}),
          },
        },
        { status: 422 }
      );
    }
  });

  return router;
}

/** Whether this person may update the table — the fallback for a move nobody restricted. */
/** The same refusal, with `details.phase` (and any extra) added; status and body otherwise kept. */
async function withPhase(response, phase, extra = {}) {
  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  return json({ ...body, details: { ...(body.details ?? {}), ...extra, phase } }, { status: response.status });
}

async function updateAllowed(db, user, tableName) {
  try {
    await checkOperationAccess(db, user, tableName, "update");
    return true;
  } catch {
    return false;
  }
}

/** 409 RECORD_FINAL for a record at the end of its flow, else null. */
function lockedResponse(model, entity, current) {
  const lifecycle = lifecycleOf(model, entity.tableName);
  if (!lifecycle || !isLocked(lifecycle, current[lifecycle.column])) return null;
  return json(
    {
      statusCode: 409,
      message: "This record is Final and cannot be changed. Reopen it to make changes.",
      details: {
        code: "RECORD_FINAL",
        entity: entity.tableName,
        id: current.id,
        state: current[lifecycle.column],
      },
    },
    { status: 409 }
  );
}

/** Only apply a rule's `set` when the target is a real column of the entity. */
function applicableMutations(entity, mutations) {
  const applicable = {};
  for (const [field, value] of Object.entries(mutations || {})) {
    const attribute = entity.attributes.find((item) => item.columnName === field);
    if (attribute) applicable[field] = coerce(value, attribute);
  }
  return applicable;
}

/** Record a state change against the entity's machine, when it crossed one. */
async function recordWorkflowRun(db, model, entity, before, after, user) {
  const workflow = await stateMachineFor(db, model, entity.name);
  const column = statusColumn(entity, workflow);
  if (!column) return;
  const from = before[column];
  const to = after[column];
  if (!to || from === to) return;

  const transition = (workflow?.transitions || []).find(
    (item) => item.from === String(from) && item.to === String(to)
  );

  await db.insert("sys_workflow_runs", {
    workflow_name: workflow ? workflow.name : `${entity.name} status`,
    entity_name: entity.name,
    record_id: after.id,
    from_state: from == null ? null : String(from),
    to_state: String(to),
    trigger: transition?.trigger ?? null,
    status: transition ? "completed" : "unmodelled",
    detail: JSON.stringify({ modelled: !!transition }),
    created_by: user.id,
  });
}
