# Scripts

Everything here is invoked by a `package.json` script, by CI, or by the Docker
entrypoint. Nothing is a standalone tool you are expected to remember.

This file used to document four shell scripts that tested "Option 1 (Next.js +
NestJS)" and "Option 2 (OData + OpenUI5)". Both stacks are gone — the generator
emits one, `tanstack-start-nestjs` — and so are the scripts.

## Build

The four committed artifacts CI rebuilds and compares byte for byte. Run the
matching script after editing its sources, or the `Type-check, lint and unit
tests` job fails after everything else in it has passed. Each takes `--check`.

| Script | Rebuilds |
|---|---|
| `build-wasm-runtime.ts` | `runtime-assets.generated.ts`, `overlay-assets.generated.ts` |
| `build-fullstack-browser.ts` | `html/assets/appwithai-fullstack.js` |
| `build-wasm-browser.ts` | `html/assets/appwithai-wasm.js`, `html/wasm-app/sw.js` |
| `build-language-tools.ts` | `html/checker.js`, `html/fixer.js` |
| `build-stack-templates.ts` | The templates beside `run-real-stack.html` — generated, not committed |
| `vendor-pglite.ts` | PGlite beside `html/`, so the wasm E2E does not depend on a CDN |

`lib/build-env.ts` is shared by them: it reports whether your bun version and
platform match CI's, because `Bun.build` output depends on both.

## Database

| Script | Purpose |
|---|---|
| `seed-admin-account.ts` | `bun run seed:admin` — migrations, then the bootstrap administrator |
| `seed-model.ts` | Run by `docker/entrypoint.sh` when `SEED_MODEL` is set |

## CI

`ci/` holds the checks that are too large for a unit test:

| Script | Asserts |
|---|---|
| `llmtext-claims.ts` | `website/llmtext/*.txt` still describes what the checker really does |
| `language-tools-smoke.ts` | The published `checker.js`/`fixer.js` agree with the CLI |
| `wasm-smoke.ts` | A generated WebAssembly-Postgres backend answers over HTTP |
| `neon-db.ts` | Neon database provisioning for the branch workflows |

## Setup

`setup/setup.sh` checks prerequisites, installs and builds every package.
`ensure-packages-built.ts` is the narrower version `bun run dev` runs on every
start: it builds only the workspace packages whose entry point is missing, so a
fresh clone works without anyone having to know that it had to be built first.
It also refuses to start when `node_modules` no longer matches the manifests,
naming the stale dependency and asking for `bun install`.

## Also in the repository root

`start.sh` and `stop.sh` start and stop a local development stack.

## Prerequisites

Bun 1.4.4 — the version CI pins. PostgreSQL 14+ for anything that touches a
database. See `CLAUDE.md` for why the bun version is load-bearing.
