---
name: qa-lifecycle-workflows
description: QA the lifecycle state machine, business rules, workflow bindings, RBAC grants, and the two-transaction button press in a generated AppWithAI application. Use when asked to test workflows, test the lifecycle, test business rules, verify state machines, or QA the rules and workflows system end-to-end.
---

# QA: Lifecycle, Workflows & Business Rules

This skill drives the complete QA flow for a generated application's lifecycle
system — state machines, action buttons, workflow bindings (`ENTER:<STATE>`),
business rules (GoRules), RBAC grants, and the two-transaction button press.

Read `docs/VisualDesign-Workflow-BusinessRules.md` for the full architecture.
This skill is the runbook.

## Before you start

You need a generated application running. If one is not already up:

```bash
bun run wasm generate -i <model.eml.mmd> -o /tmp/test-app --force
cd /tmp/test-app
bun install
bun run dev
# frontend on :4000, backend on :4001
# Sign in: admin@admin.com / (password the seed printed)
```

Or use the `generate-and-run-app` skill to do this for you.

For the modelling tool's editor tests, just `bun run dev` from the repo root
(http://localhost:3000).

## Phase 1: Unit & Integration Tests

Run these first — they are fast and catch compilation/template errors.

```bash
bun run test
```

If a specific area is suspect, run targeted suites:

```bash
# Lifecycle compilation
bun --filter @appwithai/web test -- packages/generator/src/templates/__tests__/record-lifecycle-templates.test.ts

# Status-bound workflows (ENTER:<STATE>)
bun --filter @appwithai/web test -- packages/generator/src/templates/__tests__/status-bound-workflows.test.ts

# Workflow step values (formula, create, decision)
bun --filter @appwithai/web test -- packages/generator/src/templates/__tests__/workflow-step-values.test.ts

# Saga compilation (sagaOperation, ENTER: generation)
bun --filter @appwithai/web test -- packages/generator/src/workflows/__tests__/compile-sagas.spec.ts

# Status choices for the editor
bun --filter @appwithai/web test -- packages/editors/src/lib/eml/__tests__/status-choices.test.ts

# Workflow hooks (statusChoicesFor, canBindStatus)
bun --filter @appwithai/web test -- packages/editors/src/lib/eml/__tests__/workflow-hooks.test.ts
```

**Pass criteria:** all green, 0 failures.

## Phase 2: Editor E2E (Modelling Tool)

These drive the Logic step in the modelling tool via Playwright.

```bash
# One spec at a time — do NOT run 01–04 together (starves dev server)
cd scripts/e2e-rules-workflows
bunx --bun playwright test -c playwright.config.ts specs/01-business-rules-editor.spec.ts
bunx --bun playwright test -c playwright.config.ts specs/02-workflow-editors.spec.ts
bunx --bun playwright test -c playwright.config.ts specs/03-graph-rules.spec.ts
```

| Spec | Covers | ~Duration |
|------|--------|-----------|
| 01 | 41 decision table rules, all operators, try-it | 30 min |
| 02 | 50 workflows: hooks, state machines, processes | 15 min |
| 03 | 11 graph rules: Expression, Function, Switch | 10 min |
| 14 | All step types, 59-step process, hooks with rules | 30 min |

**Pass criteria:** all assertions green, no timeout failures.

## Phase 3: Editor E2E (Generated App)

Point the same editor specs at the generated app's Admin → Rules and workflows:

```bash
LOGIC_TARGET=generated bun run test:e2e:rules-workflows -- specs/01
```

Or run specs that generate, boot and drive the app end-to-end:

```bash
bun run test:e2e:rules-workflows -- --generated specs/12-generated-state-machine.spec.ts
```

`--generated` creates a fresh database (`<db>_rules_workflows_e2e`) — never
touches the tool's database.

## Phase 4: Generated App Suites

These run inside the generated application.

```bash
cd /tmp/test-app   # or wherever you generated
bun run test:e2e   # all suites
```

Key suites for lifecycle/workflows:

| Suite | What it holds |
|-------|---------------|
| `05-rules` | Rule enforcement per entity: prevent, transform, trigger-workflow |
| `06-rules-workflow` | Workflow runs logged in sys_workflow_runs |
| `06b-workflow-transitions` | State machine edges: drawn accepted, undrawn refused |
| `06c-status-bound-workflow` | Two-transaction button press: 422 on failure, typed values survive, retry works |
| `15-record-lifecycle` | Promotion on create, doc_status, locked Final records |

**Run every suite TWICE on one database** — unique constraints behave
differently on repeat runs.

## Phase 5: Manual Lifecycle Walkthrough

For each entity with a state machine, verify this sequence in the browser:

### 5a. Create → Draft → Promotion

1. Create a record → verify `doc_status: 'draft'` in the response
2. Check it promoted to `afterDraft` (the machine's first state)
3. If promotion failed → check `doc_status: 'error'` and `doc_status_message`

### 5b. Action Buttons

1. `GET /bus/:entity/:id/actions` → verify only valid moves listed
2. Press each button in sequence:
   - Status moves to the target state
   - `<state>_at` timestamp is set
   - `sys_record_transitions` has a new log entry
   - Bound workflows ran (check `sys_workflow_runs`)
3. Try an **undrawn transition** → expect 409 `INVALID_TRANSITION`
4. Reach a **terminal state** → expect 409 `RECORD_FINAL` on edit or delete

### 5c. Two-Transaction Pattern

1. Fill in form fields AND press a status button
2. If the bound workflow fails (422 `WORKFLOW_FAILED`):
   - Reload → form values are saved (version = old + 1)
   - Status is unchanged
   - `doc_status_message` shows the reason
   - Failed run in `sys_workflow_runs`
3. Fix the cause and press again → status moves

### 5d. Workflow Binding (ENTER:<STATE>)

For each workflow with `ENTER:<STATE>`:

1. Move a record to the bound state → verify workflow ran
2. Introduce a failure (bad REST URL, missing field)
3. Press button → 422, values saved, status unmoved, error visible
4. Fix and retry → succeeds

### 5e. Business Rules

1. Create a record triggering a `prevent` rule → 422 with rule message
2. Create a record triggering a `transform` → field modified in response
3. Create a record triggering `trigger-workflow` → process started
4. On button press: record whose after-move state trips a refusing rule → 422

### 5f. RBAC

1. As a granted role → button present, press works
2. As an ungranted role → button absent or 403 `TRANSITION_FORBIDDEN`
3. Reopen → only administrator (unless grant says otherwise)

## Phase 6: WASM Browser Stack

```bash
bun run vendor:pglite
bun run build:stack-templates
bun run test:wasm
```

Chapter 09 in `tests/e2e/wasm/browser.e2e.spec.ts` covers workflow state
machines and access control in the browser stack.

## Reporting

After running all phases, summarise:

- **Unit tests:** N passed / N failed
- **Editor E2E (tool):** specs 01, 02, 03, 14 — pass/fail
- **Editor E2E (generated):** specs 12, 15 — pass/fail
- **Generated app suites:** 05, 06, 06b, 06c, 15 — pass/fail (both runs)
- **Manual walkthrough:** each entity's lifecycle: pass/fail with notes
- **WASM:** chapter 09 — pass/fail

If any phase fails, report the specific assertion, the suite, and whether the
failure is in rules, workflows, lifecycle, RBAC, or the two-transaction pattern.

## Fixture Model

`tests/test-data/dance-studio-workflows.eml.mmd` — all 25 behaviour constructs.
Use it when you need a model that exercises everything.

## Adding Test Cases

- New rule scenario → `scripts/e2e-rules-workflows/scenarios/rule-catalogue.ts`
- New workflow scenario → `scripts/e2e-rules-workflows/scenarios/workflow-catalogue.ts`
- Controls found by on-screen labels, never by position.
