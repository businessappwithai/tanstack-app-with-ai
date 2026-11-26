/**
 * `/workflows` and `/workflow-definitions` — the processes the model declared.
 *
 * A state machine still has no endpoint that "runs" it, and inventing one would
 * be a second way to change a record's status that the guards, hooks and rules
 * on the ordinary update path know nothing about. **Moving a record is a PUT to
 * the record**, and that has not changed.
 *
 * What this module now also does is let an administrator edit the machine
 * itself — create a definition, change its transitions, retire it. That is a
 * different thing from running one: it changes which moves *exist*, not which
 * one a particular record is making, and it goes through the same table the
 * readers read (`sys_workflow_definitions`, via `lib/workflows.js`) so an edit
 * takes effect on the next request rather than at the next generation.
 *
 * Reads are open to any signed-in user; every write is administrator-only.
 */

import { isLocked, lifecycleOf, phaseOf } from "../lib/lifecycle.js";
import { Router } from "../lib/router.js";
import { badRequest, json, noContent, notFound, readJson } from "../lib/http.js";
import { requireAdmin, requireUser } from "../lib/guards.js";
import { resolveEntity } from "./bus.routes.js";
import { ident } from "../lib/db.js";
import { stateFieldFor } from "../lib/workflows.js";

export function workflowRoutes(model) {
  const router = new Router();
  /* Reads open to any signed-in user, writes administrator-only — the same
     arrangement `/sys` and `/rules` use. A state machine decides which moves a
     record may make, so editing one changes what the application permits
     everybody else to do. */
  router.use(async (request, { user }) => {
    requireUser(user);
    if (request.method !== "GET") requireAdmin(user);
  });

  router.get("/definitions", async (_request, { db }) =>
    json(await db.select("sys_workflow_definitions", { orderBy: "name" }))
  );

  router.get("/definitions/:id", async (_request, { db, params }) => {
    const row = await db.one(
      "SELECT * FROM sys_workflow_definitions WHERE sys_workflow_definition_id = $1",
      [params.id]
    );
    if (!row) throw notFound("No such workflow");
    return json(row);
  });

  /*
   * Create, update and delete a definition.
   *
   * What is stored is the workflow object itself, in `definition`, exactly as
   * the seed writes it — so a machine edited here is read back by
   * `stateMachineFor` and drives the transition UI and the run log immediately.
   * That is only true because the readers were moved onto this table; before
   * that an edit here changed nothing, which is the whole reason this shape was
   * worth building rather than a screen that looked like it worked.
   *
   * `transitions` is validated rather than trusted. A transition with no `from`
   * or no `to` is not a move, and the two readers would silently skip it — so it
   * is refused at the door rather than stored and ignored.
   */
  function workflowFields(body, entity, existing = {}) {
    const values = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest("A workflow needs a `name`");
      values.name = name;
    }
    if (entity) values.entity_name = entity.name;
    if (body.kind !== undefined) {
      const kind = String(body.kind).trim();
      if (!KINDS.has(kind)) throw badRequest(`\`kind\` must be one of ${[...KINDS].join(", ")}`);
      values.kind = kind;
    }
    if (body.is_active !== undefined) values.is_active = !!body.is_active;

    if (body.definition !== undefined) {
      const definition =
        typeof body.definition === "string" ? safeParse(body.definition) : body.definition;
      if (!definition || typeof definition !== "object") {
        throw badRequest("`definition` must be an object describing the workflow");
      }
      const kind = values.kind ?? existing.kind ?? "state";
      if (kind === "state") {
        const transitions = definition.transitions;
        if (!Array.isArray(transitions) || transitions.length === 0) {
          throw badRequest("A `state` workflow needs at least one transition");
        }
        for (const [index, transition] of transitions.entries()) {
          if (!transition || !String(transition.from ?? "").trim() || !String(transition.to ?? "").trim()) {
            throw badRequest(
              `transitions[${index}] needs both a \`from\` and a \`to\` — a half-drawn edge is not a move`
            );
          }
        }
      }
      values.definition = JSON.stringify(definition);
    }

    if (!values.definition && !existing.definition) {
      throw badRequest("A workflow needs a `definition`");
    }
    return values;
  }

  router.post("/definitions", async (request, { db }) => {
    const body = await readJson(request);
    const entityName = body.entity_name || body.entity;
    if (!entityName) throw badRequest("A workflow needs an `entity_name`");
    const entity = resolveEntity(model, entityName);
    if (!entity) throw notFound(`No entity "${entityName}" in this model`);

    const values = { kind: "state", is_active: true, ...workflowFields(body, entity) };
    const row = await db.insert("sys_workflow_definitions", values);
    return json(row, { status: 201 });
  });

  router.patch("/definitions/:id", async (request, { db, params }) => {
    const existing = await db.one(
      "SELECT * FROM sys_workflow_definitions WHERE sys_workflow_definition_id = $1",
      [params.id]
    );
    if (!existing) throw notFound("No such workflow");

    const body = await readJson(request);
    const entityName = body.entity_name || body.entity;
    let entity = null;
    if (entityName) {
      entity = resolveEntity(model, entityName);
      if (!entity) throw notFound(`No entity "${entityName}" in this model`);
    }

    const values = workflowFields(body, entity, existing);
    if (Object.keys(values).length === 0) throw badRequest("Nothing to change");
    values.updated_at = new Date().toISOString();

    const row = await db.update("sys_workflow_definitions", values, {
      sys_workflow_definition_id: params.id,
    });
    return json(row);
  });

  /*
   * Deleting a definition leaves its runs alone. `sys_workflow_runs` is the
   * record of what the application actually did, and a history that disappears
   * when somebody tidies up a definition is not a history.
   */
  router.delete("/definitions/:id", async (_request, { db, params }) => {
    const existing = await db.one(
      "SELECT sys_workflow_definition_id FROM sys_workflow_definitions WHERE sys_workflow_definition_id = $1",
      [params.id]
    );
    if (!existing) throw notFound("No such workflow");
    await db.remove("sys_workflow_definitions", { sys_workflow_definition_id: params.id });
    return noContent();
  });

  router.get("/runs", async (_request, { db, query }) => {
    const limit = Math.min(200, Number(query.get("limit") || 50));
    const entityName = query.get("entityName");
    const rows = entityName
      ? await db.select("sys_workflow_runs", {
          where: { entity_name: entityName },
          orderBy: "created_at",
          direction: "desc",
          limit,
        })
      : await db.select("sys_workflow_runs", { orderBy: "created_at", direction: "desc", limit });
    return json({ data: rows, total: rows.length });
  });

  router.get("/entity/:entityName", async (_request, { db, params }) => {
    const entity = resolveEntity(model, params.entityName);
    if (!entity) throw notFound(`No entity "${params.entityName}"`);
    const definitions = await db.select("sys_workflow_definitions", {
      where: { entity_name: entity.name },
      orderBy: "name",
    });
    return json(definitions);
  });

  /**
   * Where a record can go next — information, not an offer.
   *
   * A state is never typed: a person moves a record by pressing one of its
   * moves (POST /bus/:entity/:id/transition), whose buttons come from
   * GET /bus/:entity/:id/actions. This is the picture of the flow beside them —
   * where the record is, which moves the diagram draws from there, and whether
   * it has reached a locked end.
   */
  router.get("/entity/:entityName/:id/transitions", async (_request, { db, params }) => {
    const entity = resolveEntity(model, params.entityName);
    if (!entity) throw notFound(`No entity "${params.entityName}"`);

    const state = await stateFieldFor(db, model, entity);
    if (!state) return json({ workflow: null, column: null, current: null, transitions: [], systemManaged: true });

    const record = await db.one(
      `SELECT * FROM ${ident(entity.tableName)} WHERE id = $1 AND deleted_at IS NULL`,
      [params.id]
    );
    if (!record) throw notFound(`No ${entity.name} with id ${params.id}`);

    const current = record[state.field] ?? null;
    const transitions = (state.machine.transitions || []).filter(
      (transition) =>
        String(transition.from) === String(current ?? state.initial ?? "") && transition.to !== "[*]"
    );

    const lifecycle = lifecycleOf(model, entity.tableName);
    return json({
      workflow: state.machine.name,
      column: state.field,
      current,
      transitions,
      systemManaged: true,
      // Where the record is in its lifecycle, and whether that end is locked.
      phase: lifecycle ? phaseOf(lifecycle, current) : null,
      locked: lifecycle ? isLocked(lifecycle, current) : false,
    });
  });

  return router;
}

/**
 * The two kinds the model compiles, and the two the readers understand.
 *
 * `state` is a lifecycle — `stateMachineFor` picks it and the transition UI
 * draws it. `saga` is a multi-step process with no `transitions` of its own, so
 * it is listed and never offered as a move. A third spelling would be stored,
 * shown, and understood by neither.
 */
const KINDS = new Set(["state", "saga"]);

/** JSON that may not be JSON — the caller supplies this one. */
function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
