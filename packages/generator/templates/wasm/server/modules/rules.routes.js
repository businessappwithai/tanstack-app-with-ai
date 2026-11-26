/**
 * `/rules` — the rules the model declared, and a way to try one.
 *
 * `POST /rules/evaluate` matters more than it looks: a rule compiled from a
 * flowchart is only as trustworthy as the reading the engine gave its prose
 * decisions, and this is where that reading becomes visible. The response
 * carries the trace — which condition became which expression, and which the
 * engine could not read and assumed — so "the rule passed" is never something
 * the caller has to take on faith.
 */

import { Router } from "../lib/router.js";
import { badRequest, json, noContent, notFound, readJson } from "../lib/http.js";
import { requireAdmin, requireUser } from "../lib/guards.js";
import { evaluateRules, interpretCondition } from "../lib/rules.js";
import { resolveEntity } from "./bus.routes.js";

export function rulesRoutes(model) {
  const router = new Router();
  /*
   * Reads open to any signed-in user, writes administrator-only — the same
   * arrangement `/sys` uses, and for the same reason. Every write in this
   * application is filtered through these rules, so a rule is a statement about
   * what the business permits; someone who can edit one can decide what the
   * application accepts from everybody else.
   *
   * Keyed on the HTTP method rather than per-route, deliberately: there are more
   * write routes than anyone remembers, and one added later would otherwise
   * default to open. `POST /evaluate` is the single exception and is carved out
   * explicitly below — it writes nothing, it is the dry run.
   */
  router.use(async (request, { user }) => {
    requireUser(user);
    if (request.method === "GET") return;
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path.endsWith("/evaluate")) return;
    requireAdmin(user);
  });

  router.get("/", async (_request, { db, query }) => {
    const entityName = query.get("entityName") || query.get("entity");
    const rows = entityName
      ? await db.select("sys_rule_definitions", { where: { entity_name: entityName }, orderBy: "priority" })
      : await db.select("sys_rule_definitions", { orderBy: "priority" });
    return json(rows.map(withReading(model)));
  });

  router.get("/:id", async (_request, { db, params }) => {
    const row = await db.one("SELECT * FROM sys_rule_definitions WHERE sys_rule_definition_id = $1", [
      params.id,
    ]);
    if (!row) throw notFound("No such rule");
    return json(withReading(model)(row));
  });

  /*
   * Create, update and delete.
   *
   * A rule is four things the engine needs — the entity it binds to, when it
   * fires, in what order, and the JDM graph that decides — so those are what is
   * validated. `jdm_content` is stored as text and parsed on evaluation, which
   * means a syntactically broken graph would be accepted here and fail on the
   * next write to the entity, a long way from the screen that caused it. It is
   * parsed on the way in instead.
   *
   * `table_name` is derived rather than accepted: it is the entity's, and a
   * caller who could set it independently could bind a rule to one entity and
   * have it evaluated against another's columns.
   */
  function ruleFields(body, entity, existing = {}) {
    const values = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest("A rule needs a `name`");
      values.name = name;
    }
    if (body.description !== undefined) values.description = body.description || null;
    if (entity) {
      values.entity_name = entity.name;
      values.table_name = entity.tableName;
    }
    if (body.event !== undefined) {
      const event = String(body.event).trim();
      if (!EVENTS.has(event)) throw badRequest(`\`event\` must be one of ${[...EVENTS].join(", ")}`);
      values.event = event;
    }
    if (body.operation !== undefined) {
      const operation = String(body.operation).trim().toUpperCase();
      if (!OPERATIONS.has(operation))
        throw badRequest(`\`operation\` must be one of ${[...OPERATIONS].join(", ")}`);
      values.operation = operation;
    }
    if (body.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isInteger(priority)) throw badRequest("`priority` must be a whole number");
      values.priority = priority;
    }
    if (body.is_active !== undefined) values.is_active = !!body.is_active;
    if (body.jdm_content !== undefined) {
      const content =
        typeof body.jdm_content === "string" ? body.jdm_content : JSON.stringify(body.jdm_content);
      try {
        const graph = JSON.parse(content);
        if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
          throw new Error("a JDM graph needs a `nodes` array");
        }
      } catch (error) {
        throw badRequest(`\`jdm_content\` is not a usable JDM graph: ${error.message}`);
      }
      values.jdm_content = content;
    }
    if (!values.jdm_content && !existing.jdm_content) {
      throw badRequest("A rule needs `jdm_content` — the JDM graph that decides");
    }
    return values;
  }

  router.post("/", async (request, { db }) => {
    const body = await readJson(request);
    const entityName = body.entity_name || body.entity;
    if (!entityName) throw badRequest("A rule needs an `entity_name`");
    const entity = resolveEntity(model, entityName);
    if (!entity) throw notFound(`No entity "${entityName}" in this model`);

    const values = {
      event: "beforeCreate",
      operation: "ALL",
      priority: 100,
      is_active: true,
      ...ruleFields(body, entity),
    };
    const row = await db.insert("sys_rule_definitions", values);
    return json(withReading(model)(row), { status: 201 });
  });

  router.patch("/:id", async (request, { db, params }) => {
    const existing = await db.one(
      "SELECT * FROM sys_rule_definitions WHERE sys_rule_definition_id = $1",
      [params.id]
    );
    if (!existing) throw notFound("No such rule");

    const body = await readJson(request);
    const entityName = body.entity_name || body.entity;
    let entity = null;
    if (entityName) {
      entity = resolveEntity(model, entityName);
      if (!entity) throw notFound(`No entity "${entityName}" in this model`);
    }

    const values = ruleFields(body, entity, existing);
    if (Object.keys(values).length === 0) throw badRequest("Nothing to change");
    values.updated_at = new Date().toISOString();

    const row = await db.update("sys_rule_definitions", values, {
      sys_rule_definition_id: params.id,
    });
    return json(withReading(model)(row));
  });

  router.delete("/:id", async (_request, { db, params }) => {
    const existing = await db.one(
      "SELECT sys_rule_definition_id FROM sys_rule_definitions WHERE sys_rule_definition_id = $1",
      [params.id]
    );
    if (!existing) throw notFound("No such rule");
    await db.remove("sys_rule_definitions", { sys_rule_definition_id: params.id });
    return noContent();
  });

  router.post("/evaluate", async (request, { db }) => {
    const body = await readJson(request);
    const entityName = body.entity || body.entityName;
    if (!entityName) throw badRequest("evaluate needs an `entity`");
    const entity = resolveEntity(model, entityName);
    if (!entity) throw notFound(`No entity "${entityName}" in this model`);

    const operation = String(body.operation || "ALL").toUpperCase();
    const rules = await db.query(
      `SELECT name, jdm_content FROM sys_rule_definitions
        WHERE entity_name = $1 AND operation IN ($2, 'ALL') AND is_active = true
        ORDER BY priority`,
      [entity.name, operation]
    );

    const outcome = await evaluateRules(rules, body.data || {}, {
      columns: entity.attributes.map((attribute) => attribute.columnName),
    });
    return json({ entity: entity.name, operation, rulesEvaluated: rules.length, ...outcome });
  });

  return router;
}

/**
 * What the rules engine actually dispatches on.
 *
 * `bus.service` runs `beforeCreate`/`beforeUpdate` hooks and then
 * `enforceBusinessRules(table, data, action)`, so a rule whose event is not one
 * of these is seeded, listed, and never evaluated — the silent-inert failure the
 * dance-studio model's sixteen actions already demonstrated once. Rejected at
 * the door rather than stored.
 */
const EVENTS = new Set([
  "beforeCreate",
  "afterCreate",
  "beforeUpdate",
  "afterUpdate",
  "beforeDelete",
  "afterDelete",
]);

/** `ALL` is the wildcard the evaluate query already matches on. */
const OPERATIONS = new Set(["ALL", "CREATE", "UPDATE", "DELETE"]);

/**
 * Annotate a rule with how its decisions were read.
 *
 * Attached on the way out rather than stored, because the reading depends on
 * the entity's current columns — renaming one in the dictionary should change
 * what the rule screen says about the rule, not leave a stale note behind.
 */
function withReading(model) {
  return (rule) => {
    let graph;
    try {
      graph = JSON.parse(rule.jdm_content);
    } catch {
      return { ...rule, reading: { readable: false, decisions: [] } };
    }
    const entity = resolveEntity(model, rule.entity_name);
    const columns = entity ? entity.attributes.map((attribute) => attribute.columnName) : [];
    const decisions = (graph.nodes || [])
      .filter((node) => node.type === "switchNode")
      .map((node) => ({ label: node.name, ...interpretCondition(node.name, columns) }));
    return {
      ...rule,
      reading: {
        readable: decisions.every((decision) => !decision.assumed),
        shape: (graph.nodes || []).some((node) => node.type === "decisionTableNode") ? "decision-table" : "graph",
        decisions,
      },
    };
  };
}
