---
name: generate-and-run-app
description: Generate, build and run an application from an EML model — the NestJS + TanStack stack and the standalone browser (WASM) stack — and check it. Use when asked to run "the full application", to see what a model generates, or when a change touches packages/generator.
---

# The generated application

The modelling tool turns one `.eml.mmd` into an application through a **single path**: `packages/generator/src/pipeline/generate-application.ts`. Type-checking this repo says nothing about whether a generated app compiles — generate one and build it.

## Browser stack (no database, quickest to see)

```bash
bun run wasm generate -i language/examples/crm.eml.mmd -o /var/tmp/crm --standalone --force
cd /var/tmp/crm && npm install            # the generated app uses npm on purpose
mkdir -p vendor/pglite && cp -r node_modules/@electric-sql/pglite/dist/* vendor/pglite/
node serve.mjs --port 4000                # sign in admin@admin.com / admin
```

The `vendor/pglite` copy is required offline: the page looks for `/vendor/pglite/index.js` then falls back to a CDN, which a sandboxed container blocks ("Could not load PGlite"). `bun run vendor:pglite` does the same for `html/`. Postgres runs inside the tab as WebAssembly; first boot seeds in one transaction (~15s on the CRM model). Reporting is a separate sign-in at `#/report`.

## Full stack

`bun run wasm generate … ` without `--standalone` writes the ~413-file NestJS + TanStack project (frontend 4000, backend 4001). CI generates `examples/drug-discovery.eml.mmd` with `--records-per-entity 25`, builds backend and frontend, type-checks the generated `tests/`, and runs them with `node run.ts --no-server` against Postgres with pgvector. `docker compose up --build` uses the split Dockerfiles — see the CLAUDE.md section on its three must-holds (`COPY . .` before install, `run-app.sh` migrates, health checks probe `127.0.0.1`).

## If you touched the generator

Five committed bundles must match their sources byte for byte on Linux with the pinned bun; run all of them before pushing (they fail fast one at a time in CI):

```bash
bun run build:wasm-runtime -- --check && bun run build:fullstack-browser --check \
 && bun run build:wasm-browser -- --check && bun run build:language-tools --check && bun run build:viewers --check
```

If `--check` says the runtime differs from CI's, rebuild in `oven/bun:1.4.4`, not locally. A formatting-only edit also stales them. Editing `templates/wasm/**` needs `bun run build:wasm-runtime`.

## What a rule becomes in the app

`%%rule … event:` → a row in `sys_rule_definitions`, judged by the generated `rules-engine.service` on create/update/delete/any; `validation-error` is stored as `prevent`; `transform` and `trigger-workflow` run after commit. A state machine's edges are enforced by `entity-access.guard` for every caller.
