/**
 * Application generator (zero-dependency Node REST target).
 *
 * Emits a complete, runnable application from a validated {@link EmlModel}:
 *  - copies the static runtime (db, rules engine, workflow machines, services,
 *    validation, OpenAPI, HTTP server) from `language/cli/runtime`
 *  - generates the model-specific files: `src/model.js`, `src/hooks.js`
 *  - generates project scaffolding: package.json, README, .gitignore, and a
 *    JSON snapshot of the parsed model.
 *
 * The generated app runs with `node src/server.js` (or `bun`) — no install.
 */

import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EmlEntity, EmlModel } from "../model.ts";
import { camelCase, plural, toSnakeCase } from "../util.ts";

const RUNTIME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime");

export interface GenerateAppOptions {
  outDir: string;
  appName: string;
}

/** entity -> collection (plural snake_case) name used in routes & the datastore. */
export function collectionName(entity: EmlEntity): string {
  return plural(entity.tableName || toSnakeCase(entity.name));
}

export function generateApp(model: EmlModel, opts: GenerateAppOptions): string[] {
  const { outDir } = opts;
  const written: string[] = [];
  const srcDir = path.join(outDir, "src");
  mkdirSync(srcDir, { recursive: true });

  // 1. Static runtime files.
  cpSync(path.join(RUNTIME_DIR, "src"), srcDir, { recursive: true });
  for (const f of [
    "db.js",
    "rules.js",
    "workflows.js",
    "validate.js",
    "services.js",
    "openapi.js",
    "server.js",
  ]) {
    written.push(path.join("src", f));
  }

  // 2. Model-specific files.
  const runtimeModel = toRuntimeModel(model);
  const enums = Object.fromEntries(model.enums.map((e) => [e.name, e.values]));

  writeFileSync(
    path.join(srcDir, "model.js"),
    `// Auto-generated from EML. The single source of truth the runtime reads.\n` +
      `export const MODEL = ${JSON.stringify(runtimeModel, null, 2)};\n\n` +
      `export const ENUMS = ${JSON.stringify(enums, null, 2)};\n`
  );
  written.push("src/model.js");

  writeFileSync(path.join(srcDir, "hooks.js"), generateHooksFile(model));
  written.push("src/hooks.js");

  // 3. Scaffolding.
  writeFileSync(path.join(outDir, "package.json"), generatePackageJson(opts.appName));
  written.push("package.json");

  writeFileSync(path.join(outDir, "README.md"), generateReadme(model, opts.appName));
  written.push("README.md");

  writeFileSync(
    path.join(outDir, ".gitignore"),
    ["node_modules/", "data/", "*.log", ".DS_Store", ""].join("\n")
  );
  written.push(".gitignore");

  writeFileSync(path.join(outDir, "eml.model.json"), JSON.stringify(model, null, 2));
  written.push("eml.model.json");

  return written;
}

/** A runtime-friendly copy of the model with collection names and no diagnostics. */
function toRuntimeModel(model: EmlModel) {
  return {
    meta: model.meta,
    entities: model.entities.map((e) => ({
      name: e.name,
      collection: collectionName(e),
      tableName: e.tableName,
      primaryKey: e.primaryKey,
      timestamps: e.timestamps,
      attributes: e.attributes,
    })),
    relationships: model.relationships,
    enums: model.enums,
    indexes: model.indexes,
    rules: model.rules,
    workflows: model.workflows,
    hooks: model.hooks,
    guards: model.guards,
    triggers: model.triggers,
  };
}

function generateHooksFile(model: EmlModel): string {
  const groups = new Map<
    string,
    { handler: string; fn: string; fields: string[]; type: string; entity: string }[]
  >();
  const fnDefs: string[] = [];

  for (const hook of model.hooks) {
    const fnName = `${camelCase(hook.handler)}_${hook.entity}`;
    const key = `${hook.entity}:${hook.type}`;
    const bucket = groups.get(key) ?? [];
    if (bucket.length === 0) groups.set(key, bucket);
    bucket.push({
      handler: hook.handler,
      fn: fnName,
      fields: hook.fields,
      type: hook.type,
      entity: hook.entity,
    });

    const fieldNote = hook.fields.length ? ` [fields: ${hook.fields.join(", ")}]` : "";
    fnDefs.push(
      `// %%hook ${hook.type} ${hook.handler} on ${hook.entity}${fieldNote}\n` +
        `async function ${fnName}(data, ctx) {\n` +
        `  // TODO: implement "${hook.handler}". Return the (possibly modified) data.\n` +
        `  return data;\n` +
        `}`
    );
  }

  const registryEntries = [...groups.entries()]
    .map(([key, hooks]) => `  ${JSON.stringify(key)}: [${hooks.map((h) => h.fn).join(", ")}],`)
    .join("\n");

  return (
    `// Lifecycle hook handlers generated from the EML %%hook directives.\n` +
    `// Each handler is a stub — implement your business logic and return data.\n` +
    `// Handlers run in registration order around the entity's CRUD lifecycle.\n\n` +
    (fnDefs.length ? `${fnDefs.join("\n\n")}\n\n` : "") +
    `const registry = {\n${registryEntries}\n};\n\n` +
    `export async function runHooks(entity, type, data) {\n` +
    `  const fns = registry[\`\${entity}:\${type}\`];\n` +
    `  if (!fns) return data;\n` +
    `  let d = data;\n` +
    `  for (const fn of fns) {\n` +
    `    const r = await fn(d, { entity, type });\n` +
    `    if (r !== undefined) d = r;\n` +
    `  }\n` +
    `  return d;\n` +
    `}\n`
  );
}

function generatePackageJson(appName: string): string {
  return `${JSON.stringify(
    {
      name: appName,
      version: "1.0.0",
      private: true,
      type: "module",
      description: "Application generated from an EML (.mmd) model by the APPWITHAI EML CLI.",
      scripts: {
        start: "node src/server.js",
        dev: "node --watch src/server.js",
      },
      engines: { node: ">=18" },
    },
    null,
    2
  )}\n`;
}

function generateReadme(model: EmlModel, appName: string): string {
  const entityLines = model.entities
    .map(
      (e) =>
        `- \`${e.name}\` → \`GET/POST /api/${collectionName(e)}\`, \`GET/PUT/DELETE /api/${collectionName(e)}/:id\``
    )
    .join("\n");
  const ruleLines =
    model.rules.map((r) => `- **${r.name}** on \`${r.entity}\` (${r.event ?? "n/a"})`).join("\n") ||
    "_none_";
  const wfLines =
    model.workflows
      .map((w) => `- **${w.name}** (${w.kind}) on \`${w.entity ?? "n/a"}\``)
      .join("\n") || "_none_";

  return `# ${appName}

Generated from an **EML** model by the APPWITHAI EML CLI. Zero runtime
dependencies — it runs on plain Node (or Bun).

## Run

\`\`\`bash
npm start          # node src/server.js
# then open http://localhost:3000
\`\`\`

Set \`PORT\` to change the port and \`DATA_FILE\` to change where data persists
(default \`./data/store.json\`).

## Endpoints

${entityLines}

System: \`GET /health\`, \`GET /openapi.json\`, \`GET /api/_meta\`.

## Business rules

Evaluated automatically in the create/update lifecycle; the decision trace is
returned on the response under \`_rules\`.

${ruleLines}

## Two people editing one record

Every record carries a \`version\`, starting at 1 and raised by every save. A
read answers with it as an \`ETag\`; send it back as \`If-Match\` on \`PUT\` and a
save against a record someone else has changed since is refused with **409**
and \`details.code: "VERSION_CONFLICT"\` (with \`expectedVersion\` and
\`currentVersion\`), instead of overwriting their change. Re-read the record to
see what they did, then save again against the new version — or send that
version to overwrite on purpose. Without \`If-Match\` a save is unconditional.

\`\`\`sh
curl -i localhost:3000/api/<collection>/<id>               # ETag: "3"
curl -X PUT -H 'If-Match: "3"' -H 'Content-Type: application/json' \\
  -d '{"name":"…"}' localhost:3000/api/<collection>/<id>   # 200, or 409 if it moved
\`\`\`

## Workflows

State transitions are enforced on update (illegal transitions return HTTP 409).
Lifecycle hooks live in \`src/hooks.js\` as stubs for you to implement.

${wfLines}

## Structure

\`\`\`
src/
  server.js      HTTP server + routing (node:http)
  services.js    per-entity CRUD lifecycle
  db.js          JSON-file datastore
  rules.js       business-rule engine
  workflows.js   state machines
  hooks.js       lifecycle hook handlers (implement these)
  validate.js    request validation
  model.js       the EML model (generated)
eml.model.json   parsed model snapshot
\`\`\`
`;
}
