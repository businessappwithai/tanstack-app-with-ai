// Per-entity CRUD services.
// Wires the full lifecycle for every entity: validation, business-rule
// evaluation, lifecycle hooks, and workflow state-transition guards.

import { randomUUID } from "node:crypto";
import { all, find, insert, remove, update } from "./db.js";
import { runHooks } from "./hooks.js";
import { MODEL } from "./model.js";
import { runRules } from "./rules.js";
import { HttpError, validate } from "./validate.js";
import { canTransition, nextStates, stateMachines } from "./workflows.js";

const nowIso = () => new Date().toISOString();

export function collectionFor(entityName) {
  const meta = (MODEL.entities ?? []).find((e) => e.name === entityName);
  return meta?.collection ?? entityName.toLowerCase();
}

export function makeService(entityName) {
  const col = collectionFor(entityName);
  const sm = stateMachines[entityName];

  return {
    entity: entityName,
    collection: col,

    async list() {
      return all(col);
    },

    async get(id) {
      const row = find(col, id);
      if (row) await runHooks(entityName, "afterRead", row);
      return row;
    },

    async create(body) {
      let data = { ...body };
      data = await runHooks(entityName, "beforeCreate", data);
      data = await runHooks(entityName, "customValidate", data);
      data = validate(entityName, data, "create");

      const ruleTrace = runRules(entityName, "beforeCreate", data);

      if (sm && !data[sm.statusField]) data[sm.statusField] = sm.initial;

      const ts = nowIso();
      const row = {
        id: data.id || randomUUID(),
        ...data,
        version: 1,
        created_at: ts,
        updated_at: ts,
      };
      insert(col, row);
      await runHooks(entityName, "afterCreate", row);
      return ruleTrace.length ? { ...row, _rules: ruleTrace } : row;
    },

    /**
     * `expectedVersion` is the version the caller read (from `If-Match`).
     * When it is given and the record has moved past it, the save is refused
     * with 409 VERSION_CONFLICT rather than overwriting someone else's change.
     * Without it the save is unconditional, as before.
     */
    async update(id, body, expectedVersion) {
      const existing = find(col, id);
      if (!existing) return null;
      assertVersion(entityName, id, existing, expectedVersion);

      let data = { ...body };
      delete data.version;
      data = await runHooks(entityName, "beforeUpdate", data);

      // Enforce workflow transition when the status field changes.
      if (sm && data[sm.statusField] && data[sm.statusField] !== existing[sm.statusField]) {
        const from = existing[sm.statusField];
        const to = data[sm.statusField];
        if (!canTransition(entityName, from, to)) {
          throw new HttpError(409, `Illegal ${entityName} transition "${from}" -> "${to}"`, {
            allowed: nextStates(entityName, from),
          });
        }
      }

      data = validate(entityName, { ...existing, ...data }, "update");
      const ruleTrace = runRules(entityName, "beforeUpdate", data);

      // Hooks above are async, so another save may have landed meanwhile. The
      // check and the write below are synchronous, so nothing can come between
      // them: this is the one that decides.
      const current = find(col, id);
      if (!current) return null;
      assertVersion(entityName, id, current, expectedVersion);
      const { version: _ignored, ...supplied } = body;
      const row = update(col, id, {
        ...supplied,
        ...pickValidated(data, supplied),
        version: (Number(current.version) || 1) + 1,
        updated_at: nowIso(),
      });
      await runHooks(entityName, "afterUpdate", row);
      return ruleTrace.length ? { ...row, _rules: ruleTrace } : row;
    },

    async remove(id) {
      const existing = find(col, id);
      if (!existing) return false;
      await runHooks(entityName, "beforeDelete", existing);
      const ok = remove(col, id);
      await runHooks(entityName, "afterDelete", existing);
      return ok;
    },
  };
}

/** 409 when the caller read an older version than the one stored. */
function assertVersion(entityName, id, row, expectedVersion) {
  if (expectedVersion === undefined) return;
  const currentVersion = Number(row.version) || 1;
  if (currentVersion === expectedVersion) return;
  throw new HttpError(409, "This record was changed by someone else after you opened it.", {
    code: "VERSION_CONFLICT",
    entity: entityName,
    id,
    expectedVersion,
    currentVersion,
  });
}

// Only persist keys the caller actually supplied (plus any coercions on them).
function pickValidated(validated, body) {
  const out = {};
  for (const k of Object.keys(body)) if (k in validated) out[k] = validated[k];
  return out;
}

/** entityName -> service instance */
export const services = Object.fromEntries(
  (MODEL.entities ?? []).map((e) => [e.name, makeService(e.name)])
);
