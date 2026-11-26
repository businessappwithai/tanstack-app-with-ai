# Phase-by-Phase Implementation Plan
## Auth, Workflow Automation & Business Rules Engine Integration
### APPWITHAI Hospital Management Software

---

> **STATUS: AWAITING APPROVAL**
>
> This document describes how the implementation will proceed — phase by phase.
> **No code will be written until this plan is approved.**
> After approval, a detailed Architectural Design Document will be produced.
> After that is approved, implementation begins phase by phase.

---

## Overview: Four Phases

| Phase | Name | Deliverable | Gate |
|-------|------|-------------|------|
| 1 | Foundation & Auth | Better Auth integrated in both stacks | Approval + E2E tests pass |
| 2 | Workflow Interception | Trigger.dev tasks wired to every CRUD operation | Approval + E2E tests pass |
| 3 | Rules Engine | GoRules Zen Engine + JDM Editor UI | Approval + E2E tests pass |
| 4 | Template Updates & Hardening | Updated generator templates + full test suite | Approval + all tests pass |

Each phase ends with:
- All unit tests passing
- Playwright E2E tests covering the new functionality
- Code committed and pushed to the feature branch
- A brief summary document of what was built

---

## Phase 1 — Foundation & Authentication

### Objective
Replace the current JWT-only authentication in both HMS stacks with Better Auth. Establish sessions, RBAC, and audit-ready auth across all protected routes.

### Scope

#### 1.1 Database Migration
- Add Better Auth schema tables to PostgreSQL: `user`, `session`, `account`, `verification`
- Add `workflow_status`, `workflow_run_id`, `created_by`, `updated_by` columns to all existing business entity tables
- Add `sys_rule_definitions` and `sys_workflow_runs` tables (empty at this phase, used in Phase 3)
- New migration file: `003_add_auth_and_workflow_tables.ts`

#### 1.2 Better Auth Core Setup (Shared)
- Create `packages/core/src/auth/better-auth.config.ts` — shared auth configuration
- Configure: email/password, Google OAuth, role plugin (admin / doctor / nurse / receptionist / billing / readonly)
- Database adapter: Knex PostgreSQL (custom adapter wrapping existing `database.service.ts`)
- Environment variables: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`

#### 1.3 NestJS/Next.js Stack — Backend (NestJS)
- Install `better-auth` and `@thallesp/nestjs-better-auth`
- Replace `auth.module.ts`: mount Better Auth handler at `/api/auth/*`
- Replace `jwt.strategy.ts` with Better Auth session strategy
- Replace `jwt-auth.guard.ts` with Better Auth guard (global default: all routes protected)
- Replace `auth.service.ts`: delegate to Better Auth session validation
- Update `main.ts`: set `bodyParser: false` (required by Better Auth)
- Update all controllers: use `@Session()` decorator for authenticated user
- Update `@AllowAnonymous()` / `@Public()` decorators: map to Better Auth's anonymous access
- Update `roles.guard.ts`: use Better Auth role from session

#### 1.4 NestJS/Next.js Stack — Frontend (Next.js)
- Install `better-auth/react`
- Create `lib/auth-client.ts` — Better Auth client instance
- Create `app/(auth)/login/page.tsx` — login form with email/password + Google OAuth button
- Create `app/(auth)/register/page.tsx` — registration form
- Update `providers.tsx`: wrap with Better Auth `SessionProvider`
- Update middleware: check session via Better Auth client
- Update all protected pages: use `useSession()` hook for session access

#### 1.5 OpenUI5/OData V4 Stack
- Install `better-auth` in OData backend
- Create `src/auth/better-auth.ts` — Better Auth instance for Fastify/Express
- Create `src/middleware/auth.middleware.ts` — session validation middleware applied to all OData routes
- Mount Better Auth handler at `/auth/*` in `server.ts`
- Update `base.controller.ts`: extract user from session context, enforce RBAC per entity/operation
- Create `src/auth/roles.ts` — role definitions matching NestJS stack

#### 1.6 Tests — Phase 1
- Unit tests: auth guard, session validation, role checks (both stacks)
- E2E Playwright tests:
  - `auth.e2e.spec.ts`: login, logout, session persistence, token expiry, role-based access denial
  - `auth-nestjs.e2e.spec.ts`: API endpoint auth validation for NestJS stack
  - `auth-odata.e2e.spec.ts`: OData endpoint auth validation

### Phase 1 Deliverables Checklist
- [ ] Better Auth schema migration applied
- [ ] Both backends fully protected by Better Auth sessions
- [ ] RBAC enforced: admin, doctor, nurse, receptionist, billing, readonly roles
- [ ] Login/logout works in Next.js UI
- [ ] OData routes protected by session middleware
- [ ] All existing E2E tests still pass
- [ ] New auth E2E tests pass
- [ ] Unit test coverage ≥ 80% for new auth code
- [ ] No JWT secrets used in application code (replaced by Better Auth secrets)

---

## Phase 2 — Workflow Interception (Trigger.dev)

### Prerequisite: Phase 1 approved and merged

### Objective
Wire a Trigger.dev background task to every CREATE, UPDATE, and DELETE operation across both HMS stacks. Implement the `draft → success | error` entity lifecycle state machine.

### Scope

#### 2.1 Infrastructure Setup
- Add Trigger.dev to `docker-compose.yml` (self-hosted: Trigger.dev v3 Docker image)
- Environment variables: `TRIGGER_SECRET_KEY`, `TRIGGER_API_URL`, `TRIGGER_PROJECT_ID`
- Create `/trigger` directory at project root (Trigger.dev convention)
- Initialize Trigger.dev SDK in both backend stacks

#### 2.2 Core Trigger.dev Task: `entity-lifecycle-workflow`
File: `/trigger/entity-lifecycle-workflow.ts`

Task logic (at this phase — rules engine called in Phase 3):
1. Receive payload: `{ entityName, entityId, operation, userId, timestamp }`
2. Open DB connection
3. Fetch the entity record by `entityId`
4. Fetch all directly related entities (via FK relationships defined in the entity schema)
5. Build JSON context: `{ entity: {...}, relations: { [relationName]: {...} }, meta: { operation, userId, timestamp } }`
6. **Phase 2 stub**: skip rules engine, apply no mutations (rules wired in Phase 3)
7. Set `workflow_status = 'success'`
8. Write `sys_workflow_runs` record with input payload and status
9. On any error: set `workflow_status = 'error'`, write error details to `sys_workflow_runs`

Retry configuration:
- Max retries: 3
- Backoff: exponential (2s → 4s → 8s)
- On final failure: set `workflow_status = 'error'`

#### 2.3 NestJS Stack — Service Integration
- Update `bus.service.ts` (generated bus entity service):
  - After INSERT/UPDATE/DELETE: set `workflow_status = 'draft'`
  - Fire `tasks.trigger('entity-lifecycle-workflow', payload)` — non-blocking
  - Return entity immediately with `workflow_status = 'draft'`
- Update all generated entity services to use this pattern
- Create `src/modules/workflow/workflow.module.ts` — Trigger.dev SDK provider
- Create `src/modules/workflow/workflow.service.ts` — wrapper for task dispatch

#### 2.4 OData V4 Stack — Controller Integration
- Update `base.controller.ts`:
  - After `createEntity`, `updateEntity`, `deleteEntity`: set `workflow_status = 'draft'`
  - Fire Trigger.dev task
- Create `src/workflow/trigger.client.ts` — Trigger.dev client for OData stack

#### 2.5 Realtime Status API
- Add `GET /api/workflows/runs/:runId` endpoint — proxy to Trigger.dev run status
- Add `GET /api/entities/:entity/:id/workflow-status` — quick poll endpoint for entity status
- Next.js UI: update entity list/detail views to show `workflow_status` badge
  - `draft` → yellow "Processing" badge
  - `success` → green "Completed" badge
  - `error` → red "Failed" badge with retry button

#### 2.6 Workflow Monitor UI (Admin)
- Create `app/admin/workflows/page.tsx` — paginated list of `sys_workflow_runs`
- Columns: Entity, ID, Operation, Status, Started, Duration, User
- Click row → detail view with full JSON payload
- "Retry" button for error status (re-triggers the Trigger.dev task)
- Filter by: entity type, status, date range, user

#### 2.7 Tests — Phase 2
- Unit tests: workflow dispatch, draft status setting, error handling, retry logic
- E2E Playwright tests:
  - `workflow-nestjs.e2e.spec.ts`: Create patient → status becomes draft → becomes success
  - `workflow-odata.e2e.spec.ts`: Same flow via OData endpoints
  - `workflow-error.e2e.spec.ts`: Simulate workflow failure → status becomes error → retry → success
  - `workflow-monitor.e2e.spec.ts`: Admin can view workflow runs, filter, retry

### Phase 2 Deliverables Checklist
- [ ] Trigger.dev infrastructure running (Docker Compose)
- [ ] `entity-lifecycle-workflow` task defined and registered
- [ ] All CRUD operations in NestJS stack fire the workflow task
- [ ] All CRUD operations in OData stack fire the workflow task
- [ ] Entity `workflow_status` transitions correctly: draft → success | error
- [ ] `sys_workflow_runs` records written for every workflow execution
- [ ] Workflow monitor UI accessible to admin users
- [ ] Entity list/detail views show workflow status badge
- [ ] All Phase 1 tests still pass
- [ ] New Phase 2 E2E tests pass

---

## Phase 3 — Business Rules Engine (GoRules)

### Prerequisite: Phase 2 approved and merged

### Objective
Integrate the GoRules Zen Engine into the Trigger.dev workflow task, replacing the Phase 2 stub. Add the JDM Editor React component to the admin panel so business analysts can manage rules without code changes.

### Scope

#### 3.1 Zen Engine Integration in Trigger.dev Task
- Install `@gorules/zen-engine` in the Trigger.dev worker context
- Update `/trigger/entity-lifecycle-workflow.ts`:
  1. After building JSON context (step 5 in Phase 2) → load matching JDM rule from DB
  2. Instantiate `ZenEngine` with the JDM JSON content
  3. Call `engine.evaluate(context)` → receive output mutations
  4. Parse output: `{ mutations: { entity: {...}, relations: { [name]: {...} } } }`
  5. Open Knex DB transaction
  6. Apply entity mutations: `UPDATE [entity_table] SET ... WHERE id = ?`
  7. Apply relation mutations: `UPDATE [related_table] SET ... WHERE id = ?`
  8. Set `workflow_status = 'success'` within same transaction
  9. Write `sys_workflow_runs` with input + output payloads
  10. Commit transaction
  11. On error: rollback transaction, set `workflow_status = 'error'`

#### 3.2 Rule Management Backend API
- Create `src/modules/rules/rules.module.ts` (NestJS)
- Create `src/modules/rules/rules.service.ts`:
  - `getRulesForEntity(entityName, operation)` — load active JDM from DB
  - `createRule(dto)` — save new JDM, increment version
  - `updateRule(id, dto)` — save updated JDM, increment version
  - `listRules(entityName?)` — list all rules, optionally filtered
  - `getRuleHistory(id)` — all versions of a rule
  - `rollbackRule(id, version)` — restore previous version
  - `validateRule(jdm)` — dry-run validation (no DB changes)
- Create `src/modules/rules/rules.controller.ts`:
  - `GET /api/rules` — list rules (admin only)
  - `GET /api/rules/:id` — get rule detail
  - `POST /api/rules` — create rule (admin only)
  - `PUT /api/rules/:id` — update rule (admin only)
  - `GET /api/rules/:id/history` — version history
  - `POST /api/rules/:id/rollback/:version` — rollback (admin only)
  - `POST /api/rules/validate` — dry-run validation
- Equivalent routes for OData stack in `src/controllers/rules.controller.ts`

#### 3.3 Seed Default HMS Rules
- Create seed file: `src/seeds/003_seed_default_rules.ts`
- Seeds basic JDM rules for core HMS entities:
  - `Patient/CREATE` — age stratification, risk level assignment
  - `Patient/UPDATE` — allergy flag recalculation
  - `Appointment/CREATE` — conflict detection (outputs validation error if conflict)
  - `Prescription/CREATE` — dosage validation
  - `Invoice/CREATE` — co-pay calculation

#### 3.4 JDM Editor React Component (Next.js Admin)
- Install `@gorules/jdm-editor` in `packages/web`
- Create `app/admin/rules/page.tsx` — rules list:
  - Table: Entity, Rule Name, Operation, Version, Status (Active/Inactive), Last Modified
  - "New Rule" button → opens create form
  - Click rule → navigate to editor
- Create `app/admin/rules/[entity]/[ruleId]/page.tsx` — rule editor:
  - Renders `<DecisionGraph value={jdm} onChange={setJdm} />` from `@gorules/jdm-editor`
  - "Save" button → PUT `/api/rules/:id`
  - "Validate" button → POST `/api/rules/validate` with current JDM
  - "Version History" panel → shows all versions with rollback option
  - "Dry Run" panel → input sample JSON → shows Zen Engine output without DB changes
- Create `app/admin/rules/new/page.tsx` — create rule:
  - Form: entity name, rule name, operation (CREATE/UPDATE/DELETE/ALL)
  - Opens JDM Editor with empty graph

#### 3.5 Rule Validation & Dry Run
- "Dry Run" endpoint: `POST /api/rules/dry-run`
  - Body: `{ entityName, entityId, operation }` OR `{ jdm, context }`
  - Runs Zen Engine with provided rule and context
  - Returns output mutations WITHOUT applying them to DB
  - Validates rule syntax before save

#### 3.6 Zen Engine Service (Shared)
- Create `packages/core/src/services/zen-engine.service.ts` — shared across both stacks
- Wraps `@gorules/zen-engine` with:
  - Rule caching (in-memory LRU cache by rule ID + version)
  - Validation helper
  - Error normalization

#### 3.7 Tests — Phase 3
- Unit tests:
  - `zen-engine.service.test.ts` — rule evaluation, caching, error cases
  - `rules.service.test.ts` — CRUD, versioning, rollback
  - `entity-lifecycle-workflow.test.ts` — full workflow with rules (mock Zen Engine)
- E2E Playwright tests:
  - `rules-editor.e2e.spec.ts`: Admin opens JDM editor, edits rule, saves, validates
  - `rules-dry-run.e2e.spec.ts`: Admin runs dry run, sees output mutations
  - `workflow-with-rules.e2e.spec.ts`: Create patient → workflow fires → rule evaluates → entity updated with rule output
  - `workflow-rule-error.e2e.spec.ts`: Invalid rule input → workflow status = error → error details shown

### Phase 3 Deliverables Checklist
- [ ] Zen Engine integrated into Trigger.dev workflow task
- [ ] DB transactions apply rule mutations atomically
- [ ] Rules CRUD API working (admin only)
- [ ] Default HMS rules seeded
- [ ] JDM Editor UI accessible at `/admin/rules`
- [ ] Business analyst can edit and save rules without code changes
- [ ] Dry run / validation works in UI
- [ ] Rule version history and rollback functional
- [ ] All Phase 1 and 2 tests still pass
- [ ] New Phase 3 E2E tests pass

---

## Phase 4 — Template Updates, Hardening & Documentation

### Prerequisite: Phase 3 approved and merged, all E2E tests passing

### Objective
Update all generator Handlebars templates to include the new auth, workflow, and rules engine integration so that every future project generated by APPWITHAI gets these capabilities by default.

### Scope

#### 4.1 Audit & Inventory
- Review every `.hbs` template in:
  - `packages/generator/templates/nextjs-nestjs/`
  - `packages/generator/templates/openui5-odatav4/`
  - `packages/generator/templates/common/`
- Map each template to the changes required (reference the impact table in the Business Enhancement Document)

#### 4.2 NestJS/Next.js Template Updates
- Update: `auth.module.ts.hbs`, `auth.service.ts.hbs`, `auth.controller.ts.hbs`
- Update: `main.ts.hbs`, `app.module.ts.hbs`, `package.json.hbs`, `.env.example.hbs`
- Update: `bus.service.ts.hbs`, `bus.controller.ts.hbs`
- Remove: `jwt.strategy.ts.hbs`, `jwt-auth.guard.ts.hbs` (replaced by Better Auth)
- Add: `trigger/entity-lifecycle-workflow.ts.hbs`
- Add: `src/modules/workflow/workflow.module.ts.hbs`, `workflow.service.ts.hbs`
- Add: `src/modules/rules/rules.module.ts.hbs`, `rules.service.ts.hbs`, `rules.controller.ts.hbs`
- Add: `src/seeds/003_seed_default_rules.ts.hbs`
- Add: `src/migrations/003_add_auth_workflow_tables.ts.hbs`
- Add: `src/migrations/004_add_entity_workflow_fields.ts.hbs`
- Add frontend: `app/(auth)/login/page.tsx.hbs`, `register/page.tsx.hbs`
- Add frontend: `app/admin/rules/page.tsx.hbs`, `[entity]/[ruleId]/page.tsx.hbs`
- Add frontend: `app/admin/workflows/page.tsx.hbs`

#### 4.3 OpenUI5/OData V4 Template Updates
- Update: `server.ts.hbs`, `base.controller.ts.hbs`, `bus.controller.ts.hbs`
- Update: `package.json.hbs`, `.env.example.hbs`
- Add: `src/auth/better-auth.ts.hbs`
- Add: `src/middleware/auth.middleware.ts.hbs`
- Add: `src/workflow/trigger.client.ts.hbs`, `entity-lifecycle-workflow.ts.hbs`
- Add: `src/rules/zen-engine.service.ts.hbs`, `rules.controller.ts.hbs`
- Add: `src/migrations/003_add_auth_workflow_tables.ts.hbs`

#### 4.4 Generator Code Updates
- Update `packages/generator/src/generators/full-stack.generator.ts`:
  - Register new templates
  - Pass new context variables to templates (entity relationship map for workflow)
- Update `packages/generator/src/templates/loader.ts`: register all new `.hbs` files
- Update `packages/generator/src/generators/nextjs-nestjs/` and `openui5-odatav4/` generator classes

#### 4.5 Hardening
- Add circuit breaker: if Trigger.dev is unreachable, log warning but don't block the HTTP response
- Add timeout job: Knex cron-style job that scans for entities stuck in `draft` > 5 minutes → sets to `error`
- Add `ENABLE_WORKFLOW_ENGINE` feature flag to `.env.example` (default: true) — allows disabling for environments without Trigger.dev
- Add `ENABLE_RULES_ENGINE` feature flag (default: true)
- Rate limiting on rules API endpoints
- Add OpenAPI/Swagger documentation for new rules and workflow endpoints

#### 4.6 Full E2E Test Suite for Generated Projects
- Update `tests/e2e/` test suites:
  - Generate a new test HMS project using updated templates
  - Run the full test suite against the generated project:
    - Auth: login, logout, RBAC
    - CRUD + workflow: all entity types
    - Rules: edit rule, trigger, verify entity update
    - Workflow monitor: view runs, retry errors
- Update existing E2E tests to account for new `workflow_status` field in API responses

#### 4.7 Documentation Updates
- Update `docs/architecture.md` — add auth, workflow, and rules sections
- Update `docs/DEVELOPMENT.md` — add setup instructions for Trigger.dev and Better Auth
- Update `CLAUDE.md` — add new env vars, new scripts
- Update `README.md` (root) — highlight new capabilities
- Create `docs/RULES-ENGINE-GUIDE.md` — business analyst guide for JDM editor

### Phase 4 Deliverables Checklist
- [ ] All NestJS/Next.js templates updated
- [ ] All OpenUI5/OData templates updated
- [ ] Generator code updated and tested
- [ ] New project generation produces working auth + workflow + rules integration
- [ ] Full E2E Playwright test suite passes against a freshly generated HMS project
- [ ] Circuit breaker and feature flags implemented
- [ ] All documentation updated
- [ ] Business analyst guide written
- [ ] Code committed, pushed, PR created

---

## Approval Gates

### Before writing the Architectural Design Document
**This plan document must be reviewed and approved.** Key questions for reviewers:

1. Is the Better Auth approach correct for the existing Fastify-based NestJS setup?
2. Should Trigger.dev be self-hosted (Docker Compose) or use Trigger.dev Cloud?
3. Are there additional entity types that need custom rules seeded?
4. Should the JDM Editor be accessible to `admin` role only, or also to a new `rules-manager` role?
5. Is the `draft → success | error` state machine sufficient, or is a `pending-approval` state needed for certain entities?
6. Should READ operations trigger the workflow (for enrichment), or only CREATE/UPDATE/DELETE?

### Before implementing each phase
Each phase plan will be reviewed for scope and feasibility before the first line of code is written.

---

## Development Environment Setup (Post-Approval)

After approval, the following new setup steps will be required for developers:

```bash
# 1. Copy new env vars
cp .env.example .env
# Fill in: BETTER_AUTH_SECRET, TRIGGER_SECRET_KEY, TRIGGER_API_URL, TRIGGER_PROJECT_ID

# 2. Start Trigger.dev (self-hosted)
docker-compose up trigger-server trigger-worker -d

# 3. Initialize Trigger.dev project
npx trigger.dev@latest login
npx trigger.dev@latest init

# 4. Run new migrations
bun run migrate

# 5. Start Trigger.dev dev server
npx trigger.dev@latest dev

# 6. Start web app and Mastra as usual
bun run dev
bun run dev:mastra
```

---

## Timeline Estimate (Reference Only)

| Phase | Estimated Effort |
|-------|-----------------|
| Phase 1 — Better Auth | 3–4 days |
| Phase 2 — Trigger.dev | 3–4 days |
| Phase 3 — GoRules | 4–5 days |
| Phase 4 — Templates + Hardening | 3–4 days |
| **Total** | **13–17 days** |

Note: These are estimates and do not account for review cycles, infrastructure provisioning, or unexpected compatibility issues.

---

## Appendix: Technology Compatibility Matrix

| Technology | Bun.js 1.4.4+ | PostgreSQL | Knex.js | Fastify | Next.js 14 |
|-----------|-------------|------------|---------|---------|------------|
| Better Auth | ✅ | ✅ | Custom adapter | ✅ (beta) | ✅ |
| Trigger.dev SDK v3 | ✅ | N/A | N/A | N/A | ✅ |
| @gorules/zen-engine | ✅ (WASM) | N/A | N/A | N/A | N/A |
| @gorules/jdm-editor | N/A (React) | N/A | N/A | N/A | ✅ |

**Key compatibility notes:**
- Better Auth + Fastify: beta support; needs `bodyParser: false` in NestJS and careful handler mounting
- `@gorules/zen-engine`: The Node.js binding uses native Rust via N-API; confirm Bun.js N-API compatibility (Bun supports most N-API modules). WASM fallback available if needed.
- Trigger.dev v3 SDK: Works with Bun.js as the task runner runtime.

