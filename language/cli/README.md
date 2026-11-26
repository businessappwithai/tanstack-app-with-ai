# EML CLI (`eml`)

A robust, zero-runtime-dependency TypeScript CLI that reads the
[APPWITHAI Modeling Language](../README.md) definition, parses an `.mmd` EML
model (ERD + business rules + workflows), validates it **with self-correction**,
and **generates a complete, runnable application** from it.

Runs under **Bun** (source) or Node (bundled). No project install required.

```bash
bun language/cli/eml.ts --help
```

## Commands

| Command | Purpose |
|---------|---------|
| `generate` | Parse → validate (self-correct) → generate an app (+Docker, +GitHub) |
| `validate` | Parse and validate a model; report diagnostics; exit 1 on errors |
| `info` | Print a summary of the parsed model |
| `help` | Show usage |

## Options

```
-i, --input <file>        Input .mmd EML file (or first positional arg)
-o, --output <dir>        Output directory for the generated app
-n, --name <name>         Application name (default: derived from the model)
    --stack <stack>       node-rest (default) | tanstack-nestjs
    --docker              Also emit Dockerfile + docker-compose.yml (node-rest)
    --github <owner/repo> Publish the generated app to a GitHub repository
    --github-token <tok>  GitHub token (else GITHUB_TOKEN / GH_TOKEN)
    --private | --public  Visibility of the created GitHub repo (default private)
    --no-autofix          Disable validation self-correction
    --force               Overwrite a non-empty output directory
    --json                Machine-readable output (validate/info)
-h, --help                Show help
-v, --version             Show version
```

## Examples

```bash
# Validate (with self-correction preview)
bun language/cli/eml.ts validate -i language/examples/helpdesk.eml.mmd

# Summarize the model
bun language/cli/eml.ts info -i language/examples/helpdesk.eml.mmd

# Generate a runnable app + Docker files
bun language/cli/eml.ts generate -i language/examples/helpdesk.eml.mmd -o ./out --docker

# Generate and publish to GitHub (needs GITHUB_TOKEN)
bun language/cli/eml.ts generate -i model.mmd -o ./out --github me/my-app --public

# Run the generated app (zero dependencies)
cd out && npm start   # → http://localhost:3000
```

## Stacks

### `node-rest` (default)

A complete, **dependency-free** Node app (`node:http` + a JSON-file datastore) —
generated entirely by this CLI and runnable with no install.

### `tanstack-nestjs`

Reuses the **shipped** generator (`packages/generator`) — its
`GeneratorOrchestrator` and the `tanstack-start-nestjs` Handlebars templates —
to produce a full **TanStack Start frontend + NestJS backend** project
(`backend/` + `frontend/`). The EML model is mapped to the core
`Entity[]`/`Relationship[]` the orchestrator consumes, and generation runs in
template-only mode (no network scaffolding). Requires the workspace deps
installed and `@appwithai/core` built once:

```bash
bun install
bun run --filter @appwithai/core build
bun language/cli/eml.ts generate -i model.mmd -o ./out --stack tanstack-nestjs
```

## Docker + CI/CD (`--docker`)

For the `node-rest` stack, `--docker` emits a `Dockerfile`, `.dockerignore`,
`docker-compose.yml`, **and** a GitHub Actions workflow at
`.github/workflows/app-ci.yml`. That workflow has everything needed to run the
generated app via **Docker + docker compose**: it builds the image
(`docker compose build`), runs it (`docker compose up -d`), health-checks
`/health`, smoke-tests `/api/_meta`, and — on push — builds and pushes the image
to GHCR. Because it lives inside the generated app, it travels with the code
when the app is published to a repository (`--github`).

## Generate from an online model in CI

The repo ships a driver workflow, `.github/workflows/eml-generate-and-publish.yml`
(`workflow_dispatch`), that points the CLI at an **online `.mmd` URL**, generates
the app (with Docker + the `app-ci.yml` workflow), and publishes it to a target
GitHub repository — reusing the CLI's `--github` publisher. Inputs: `mmd_url`,
`target_repo`, `app_name`, `stack`, `visibility`. It needs an `EML_PUBLISH_TOKEN`
secret (a PAT with `repo` + `workflow` scopes; the `workflow` scope is required to
push `app-ci.yml` into the target repo).

## Business rules → GoRules JDM

For **either** stack, each EML business rule is converted to a **GoRules JDM**
decision document via the shipped converter
(`packages/web/src/lib/jdm-converter.ts`) and written to `<out>/rules/`
(`<rule>.jdm.json` + `index.json`). Node shapes map to JDM roles
(stadium→input/output, diamond→switch, circle→function, rect→expression).

## The node-rest output

A complete, dependency-free Node app (`node:http` + a JSON-file datastore):

```
out/
  src/
    server.js      HTTP server + routing (REST CRUD per entity)
    services.js    per-entity lifecycle: validation → rules → hooks → workflow
    rules.js       business-rule engine (evaluates the decision flows)
    workflows.js   state machines (enforces legal status transitions → 409)
    hooks.js       lifecycle hook handlers (generated stubs to implement)
    validate.js    request validation (required fields, enums, coercion)
    db.js          JSON-file datastore
    model.js       the parsed EML model (source of truth)
    openapi.js     OpenAPI 3 document builder
  eml.model.json   parsed-model snapshot
  package.json  README.md  .gitignore
  Dockerfile  docker-compose.yml  .dockerignore   (with --docker)
```

The generated app wires each section of the EML model:

- **ERD** → entities, REST endpoints, persistence, validation, OpenAPI.
- **Business rules** → evaluated in the create/update lifecycle; the decision
  trace is returned under `_rules` on the response.
- **Workflows** → state transitions enforced on update (illegal → HTTP 409);
  `%%hook` handlers invoked around CRUD as stubs to implement.

## How the pieces fit

```
.mmd EML ──parser.ts──▶ EmlModel ──validator.ts──▶ (self-corrected) ──generate/*──▶ app
                 ▲
     language/appwithai-language.json  (types, cardinalities, hook types, …)
```

## Validation & self-correction

`validate` and `generate` share the same validator. With self-correction on
(default), fixable problems are repaired in place and reported as `fix`
diagnostics; without it (`--no-autofix`) they are reported as errors/warnings.

| Code | Problem | Auto-fix |
|------|---------|----------|
| `EML001` | No document name | derive a name |
| `EML101` | Duplicate entity | merge attributes |
| `EML102` | Duplicate attribute | drop the duplicate |
| `EML103` | Entity has no primary key | add `string id PK` |
| `EML120` | Relationship endpoint not an entity | synthesize a minimal entity |
| `EML130` | Field references unknown enum | warn (treated as free string) |
| `EML202` | Unknown hook type | error (not auto-fixable) |
| `EML210` | Hook bound to unknown entity | synthesize a minimal entity |
| `EML300` | Rule missing input/output node | warn |
| `EML400` | State workflow has no transitions | warn |

## Development

```bash
cd language/cli
bun install                 # dev-only: TypeScript + type packages
bun run typecheck           # bun check
```
