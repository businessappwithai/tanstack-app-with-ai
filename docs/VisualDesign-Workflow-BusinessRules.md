# Lifecycle-Driven Workflows & Business Rules

The runtime for business rules and workflows in a generated AppWithAI application.
Rules decide what may happen; workflows decide what happens next; the lifecycle
state machine decides when. Every record has one lifecycle, and its action buttons
— not saves — move it from state to state.

---

## Core Principles

> **GoRules tells you _what_ should happen** — pure decisions, no side effects.
> **Workflows tell you _how_ it happens** — orchestrated steps inside a transaction.
> **The lifecycle tells you _when_** — a state machine whose drawn edges are action buttons.

A save puts a record in Draft and runs the promotion pipeline. A button press
moves it along its flow and runs the workflows bound to that transition. The two
are separate transactions, and a failure in the second never loses the first.

---

## The Record Lifecycle

Every generated table carries a `doc_status` column (the phase: `draft`, `active`,
`final`, `error`) and, when the model declares a state machine, a **state field**
(`status`, `state`, or `stage` — first match wins, from `STATE_FIELD_CANDIDATES`
in `language/state-field.ts`).

### Save Modes

`saveMode(lifecycle, currentValue)` in the generated `lifecycle.ts` returns one of
three modes that govern what a save does:

| Mode | When | What happens |
|------|------|--------------|
| **`pipeline`** | Record is in Draft or Error | Full promotion: rules + automatic workflows + move to `afterDraft` |
| **`in-place`** | Record is part-way along its flow (active) | Edit committed, update workflows run atomically in the same transaction, status unchanged |
| **`locked`** | Record is in a terminal state (Final) | 409 `RECORD_FINAL` — no edit, no delete |

### State Machine

A model declares a state machine with `%%workflow` of `kind: state`:

```
stateDiagram-v2
    [*] --> qualification
    qualification --> proposal
    proposal --> negotiation
    negotiation --> closed_won
    negotiation --> closed_lost
    closed_won --> [*]
    closed_lost --> [*]
```

- **`afterDraft`** is the machine's first state (e.g. `qualification`). A newly
  promoted record lands here, not at `"final"`.
- **Terminal states** are those with an edge to `[*]`. They are Final and locked.
- **Buttons are named after the state they enter.** `moveLabel` turns
  `closed_won` into "Closed won" — the event label on the arrow is for RBAC and
  logs, never shown to the user as a button label.
- An entity with **no** state machine goes Draft → Final on every successful
  promotion, and Final is never locked (each save re-runs Draft → Final).

### The Promotion Pipeline (`EntityPromotionService`)

On a save in `pipeline` mode:

1. Record written as **Draft** (`doc_status: 'draft'`, `doc_status_message` cleared)
2. `promotionDispatcher.dispatch()` → `promote()`:
   - Collects matching rule actions (`collectActionableActions`)
   - Finds automatic workflow names (`findWorkflowNames`)
   - If nothing to run → finalise directly (fast path)
   - Otherwise, **one transaction**:
     - `rulesService.executeMatchedActions()` — GoRules decisions applied
     - `workflowService.runLocalWorkflows()` — automatic workflows only
     - `moveOn(afterDraft)` — status set to the machine's first state, or `"final"`
3. **On failure:**
   - Rule failure → `doc_status: 'error'`, `doc_status_message` set
   - Workflow failure → `doc_status: 'draft'`, `doc_status_message` set
   - Transaction rolled back — no partial side effects

The promotion runs **synchronously in-process** by default. Trigger.dev is used
only when `TRIGGER_SECRET_KEY` is configured (via `promotion-dispatcher.service.ts`).

---

## Action Buttons & Transitions (`TransitionService`)

A record moves only by its action buttons. `POST /bus/:entity/:id/transition`
(`{event}` or `{to}`, `If-Match` required — 428 without) runs:

1. **Row lock + version check** (409 `VERSION_CONFLICT` if someone saved first)
2. **Edge check:** `findMove(lifecycle, from, {event, to})` — must be a drawn edge
   (409 `INVALID_TRANSITION`)
3. **Role check:** `CapabilityService.decide()` — `%%rbac` grants
   (403 `TRANSITION_FORBIDDEN`)
4. **Refusing rules:** validated against the record as it will be after the move (422)
5. **Write:** state field, `doc_status`, `<state>_at` timestamp, `version + 1`
6. **Run workflows** (in order):
   - Update workflows (unless `afterSave`)
   - `TRANSITION:<event>` workflows (bound to the arrow's event)
   - `ENTER:<state>` workflows (bound to entering the target state)
7. **Trigger rules:** rules that start processes (`triggersOnly: true`)
8. **Log:** `sys_record_transitions`

### The Two-Transaction Button Press

A button press carries the form's unsaved values as `data`:

- **Transaction 1 (save):** Writes the form values. Record stays in its current
  status. Version incremented.
- **Transaction 2 (move):** The transition plus every workflow bound to
  `ENTER:<state>` and `TRANSITION:<event>`. If a workflow fails:
  - Only transaction 2 rolls back
  - The answer is 422 `WORKFLOW_FAILED` with `details.workflow`, `details.phase`
    (`save` or `workflow`), and the reason
  - The typed values stay saved (version is up by one)
  - The status has **not** moved
  - The failed run is written to `sys_workflow_runs` after rollback (visible in
    Run History)
  - The reason appears in `doc_status_message`, shown beside the buttons on the
    record form

---

## Workflow Binding: `ENTER:<STATE>`

A workflow can carry a status beside its hook: "after update on Contract, **when
the status becomes To be reviewed**". In EML:

```
%%workflow ReviewContract entity: Contract trigger: automatic operation: UPDATE status: to_be_reviewed
```

This compiles to `operation = ENTER:TO_BE_REVIEWED`. The transition service
selects it when a button press moves a Contract record into the `to_be_reviewed`
state.

| Trigger | When it runs |
|---------|--------------|
| `CREATE` / `UPDATE` / `DELETE` / `ALL` | Standard automatic triggers on save |
| `ENTER:<STATE>` | When a button press enters that state |
| `TRANSITION:<event>` | When a specific arrow/event fires |

Migration `024_widen_workflow_operation` widened the `operation` column from
`varchar(20)` to accommodate these longer values.

---

## Business Rules (GoRules)

Rules are pure decisions — they evaluate conditions and produce a verdict. They
never write to the database.

### Rule Types

| Type | Storage | Execution |
|------|---------|-----------|
| **Decision table** | `sys_rule_definitions` row, JDM graph with table node | `@gorules/zen-engine` evaluates, `collect` hit policy (every matching row runs) |
| **Graph rule** | `sys_rule_definitions` row, JDM graph with expression/function/switch/table nodes | `@gorules/zen-engine` evaluates the full graph |

### Rule Actions (the runtime's vocabulary)

EML writes one vocabulary; the runtime reads another. The generator translates:

| EML writes | Runtime reads | Effect |
|------------|---------------|--------|
| `validation-error` | `prevent` | `validate()` rejects the write |
| `transform field: … value: …` | `transformData` object | Modifies the record before save |
| `trigger-workflow` | `trigger-workflow` + `workflowName` | Starts a named process |

### Rule Evaluation Points

- **On save (pipeline mode):** `executeMatchedActions()` in promotion — rules that
  `prevent` block the promotion; transforms modify the record; workflow triggers
  start named processes.
- **On button press:** refusing rules are checked against the record as it will be
  after the move. If any `prevent`, the move is refused (422).
- **After transition:** trigger rules (`triggersOnly: true`) fire processes bound
  to the new state.

### `collect` vs `first` Hit Policy

- **`collect`** (used by `%%action` rules): every matching row runs. A blank
  `prevent` row refuses every write.
- **`first`**: first match wins, remaining rows shadowed. Used for priority-based
  decisions.

---

## Workflow Steps

Workflows are compiled to BPMN XML and executed by the TypeScript BPMN executor
in `workflow.service.ts`. Steps are defined in `packages/generator/src/workflows/steps.ts`.

### Step Types (`STEP_TYPES`)

| Step | What it does |
|------|-------------|
| **UpdateEntity** | Updates a record's fields |
| **CreateEntity** | Creates a new record |
| **DeleteEntity** | Deletes a record |
| **Decision** | Evaluates a named rule and branches |
| **Formula** | Computes a value (`add`, `subtract`, `multiply`, `divide`, `set`, `concat`) |
| **REST** | Makes an HTTP call |
| **Agent** | Invokes an AI agent |
| **Loop** | Repeats contained steps while a condition holds, bounded by `max:` |

Each step has a contract (`STEP_CONTRACTS`) listing required fields, optional
fields, one-of constraints, and what it publishes to the workflow context.

### Formula Notes

- A formula's second value may be a variable: `right: {{x}}` — `resolveReference`
  reads a field that is exactly one `{{reference}}` as its runtime value
- A Create step's text values are interpolated: `Commission {{commission}}`

---

## RBAC and Access Control

`%%rbac role:<roles> on <Entity>.<event>` compiles to `kind: move` / `reopen`
rows of `sys_access_grant`.

- A move a grant names → only those roles may press the button
- A move no grant names → needs update permission
- Reopen with no grant → administrator only
- A user's access = **union** of their roles' grants, read through
  `sys_user_capability` view, cached per user by `CapabilityService`
  (`CACHE_TTL_<NAME>_MS` in `.env`, default 6000ms, `0` disables)
- Cache dropped on `pg_notify('access_changed')`

---

## The Editor UI

Both the modelling tool (Logic step) and the generated application (Admin → Rules
& workflows) use the same `LogicWorkbench` component from
`packages/editors/src/components/LogicWorkbench.tsx`. The only difference is the
I/O host adapter.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Left Rail (256px)          │  Right Panel              │
│                             │                           │
│  ── Rules ──────────── [+]  │  (depends on selection)   │
│  │ invoiceValidation        │                           │
│  │ discountCheck            │  Rule → RuleEditor        │
│  │ ...                      │  New workflow → NewPanel   │
│                             │  Hook workflow → Ladder +  │
│  ── Workflows ──────── [+]  │     WorkflowRules         │
│  │ ⚡ afterCreate hooks     │  State machine → Canvas   │
│  │ 🔀 opportunity flow      │  Process → AutoBuilder    │
│  │ 📋 closedWonHandoff      │                           │
│  │ (model) badge on locked  │                           │
│                             │                           │
│  + status machine           │                           │
│  + process                  │                           │
└─────────────────────────────────────────────────────────┘
```

### Creating a Rule

1. Click **"New rule"** → adds `rule{N}` with first entity, `beforeCreate` event
2. **RuleEditor** opens:
   - Name, entity, event selectors
   - Decision table (input conditions + output action column) or GoRules graph
     editor (drag Expression, Function, Switch, Decision Table, Response nodes)
   - **Try it** panel for dry-run testing
3. Save via bottom **"Save"** button

### Creating a Workflow

1. Click **"New workflow"** → `NewWorkflowPanel` opens:
   - **Workflow name** (text input)
   - **Watches** (entity select)
   - **Attach it to this hook** (dropdown: 13 hook types in Write / Read groups —
     `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`,
     `afterDelete`, `customValidate`, `beforeRead`, `afterRead`, `beforeQuery`,
     `afterQuery`, `beforeList`, `afterList`)
   - **When the status becomes** — shown only when hook is `beforeUpdate` or
     `afterUpdate` AND the entity has a state machine:
     - Dropdown of states that some arrow **enters** (`statusChoicesFor` scans
       all transitions)
     - Stores as `operation = ENTER:<STATE>` (uppercased, snake_case)
     - Help text: *"The button saves the form first, in its current status. This
       workflow then runs in another transaction and, if it succeeds, the status
       moves on."*
2. After creation → **AutomationBuilder** (ladder view) for adding steps

### Creating a Status Machine

1. Click **"status machine"** link at bottom of rail
2. **WorkflowEditor** → **StateFlowCanvas** (ReactFlow-based graph):
   - Add states (nodes)
   - Draw arrows (transitions) with optional event labels
   - Mark states as **initial** (▶) or **terminal** (⚑)
3. States become the entity's status enum; transitions become action buttons

### Creating a Process

1. Click **"process"** link at bottom of rail
2. **AutomationBuilder** opens with a blank process
3. Add steps from the step type palette: UpdateEntity, CreateEntity, DeleteEntity,
   Decision, Formula, REST, Agent, Loop
4. Each step has an inspector panel for configuring its properties

### Attaching Rules to a Hook

Below the AutomationBuilder ladder, **WorkflowRules** shows:
- Rules already attached (same entity + same operation)
- Rules available to attach (same entity, different event)
- **"Attach"** button reassigns the rule's `event` field
- A rule has **one** event, so attaching to a second hook **moves** it

### Model-Locked Items

Workflows declared in the EML model are shown with a **"model"** badge, Delete is
hidden, and the editor is set to `inert`. The `save` callback never writes them.
A rule the model seeded shows its identifier (no `title` column for model rules).

### Generated App Differences

The generated app's host (`logic-host.ts`):
- Loads from `/api/rules`, `/api/workflow-definitions`
- Saves by diffing: DELETEs removed, PUTs changed, POSTs new
- Provides `RULE_MODEL` for entity/field names
- Provides `POST /rules/simulate` for dry-run
- Model workflows shown read-only; state flows stored only once edited

---

## Architecture Diagram

```
User saves form
  │
  ▼
bus.service.ts (update/create)
  saveMode() → pipeline | in-place | locked
  │
  ├─ pipeline (Draft/Error):
  │    Write record as DRAFT
  │    ▼
  │    EntityPromotionService.promote()
  │      ▼ one transaction:
  │      executeMatchedActions() ← GoRules decisions
  │      runLocalWorkflows()     ← automatic workflows
  │      moveOn(afterDraft)      ← first flow state or "final"
  │      ▼ on failure:
  │      rollback → doc_status=error | draft + message
  │
  ├─ in-place (Active):
  │    Write record (keep state)
  │    ▼ same transaction:
  │    runInTransaction() ← update workflows only
  │
  └─ locked (Final):
       409 RECORD_FINAL

User presses action button
  │
  ▼
TransitionService.move()
  lock row, check version
  findMove(lifecycle, from, {event, to})
  decide(actor, tableName, move) ← role check
  validate rules on after-state
  ▼
  Transaction 1: save form data (status unchanged)
  Transaction 2: move status + run workflows
    ├─ update workflows
    ├─ TRANSITION:<event> workflows
    ├─ ENTER:<state> workflows
    └─ trigger rules (start processes)
  ▼ on workflow failure:
  only transaction 2 rolls back
  typed values saved, status unmoved
  reason in doc_status_message
```

---

## Key Files

| File | Purpose |
|------|---------|
| `language/state-field.ts` | Lifecycle names, `moveLabel`, `STATE_FIELD_CANDIDATES`, terminal detection |
| `packages/generator/src/generators/tanstack-start-nestjs/lifecycle-module.ts` | Generates `lifecycle.ts` for both stacks, `saveMode`, `afterDraft`, `lifecycleTable` |
| `packages/generator/src/workflows/steps.ts` | Step types, contracts, `buildSagaBpmn`, `sagaOperation` (ENTER: compilation) |
| `packages/generator/src/rules/index.ts` | `%%action` → decision-table rows, vocabulary translation |
| `packages/generator/src/hooks/index.ts` | `%%hook` → lifecycle handler modules |
| `packages/editors/src/components/LogicWorkbench.tsx` | The shared editor screen (rail, editors, save) |
| `packages/editors/src/components/NewWorkflowPanel.tsx` | Workflow creation with status binding |
| `packages/editors/src/components/WorkflowRules.tsx` | Rule-to-hook attachment |
| `packages/editors/src/components/StateFlowCanvas.tsx` | ReactFlow-based state machine editor |
| `packages/editors/src/components/AutomationBuilder.tsx` | Process/hook workflow step ladder |
| `packages/editors/src/components/RuleEditor.tsx` | Decision table + graph editor + Try it |
| `packages/web/src/lib/eml/workflow-hooks.ts` | `statusChoicesFor`, `statusLabel`, `canBindStatus` |
| `packages/web/src/lib/automation/model.ts` | Automation builder model (second reader/writer of EML) |
| `packages/web/src/lib/workflow/bpmn-model.ts` | BPMN model, `evaluateExpression` |
| `.../transition.service.ts.hbs` | Button press: two transactions, run bound workflows |
| `.../entity-promotion.service.ts.hbs` | Save pipeline: rules + workflows + moveOn |
| `.../workflow.service.ts.hbs` | Saga execution: BPMN XML parsed and walked |
| `.../rules-engine.service.ts.hbs` | GoRules evaluation, `validate`, `executeMatchedActions` |
| `.../bus.service.ts.hbs` | `getEntityMetadata`, `saveMode` routing |

---

## QA Testing Guide

This section is the complete testing playbook for workflows, business rules, and
lifecycle behaviour. It is used by the `/qa` skill to verify the system.

### Prerequisites

| What | How |
|------|-----|
| **Modelling tool running** | `bun run dev` → http://localhost:3000 |
| **Generated app running** | `bun run wasm generate -i <model> -o /tmp/app --force` then `cd /tmp/app && bun install && bun run dev` (frontend :4000, backend :4001) |
| **Database** | `DATABASE_URL` set, `bun run seed:admin -- --email admin@admin.com` run |
| **Playwright browsers** | `bunx playwright install chromium` |

### Test Matrix

#### 1. Unit & Integration Tests

```bash
# All unit tests (includes rule/workflow/lifecycle template tests)
bun run test

# Key individual suites:
bun --filter @appwithai/web test -- packages/generator/src/templates/__tests__/status-bound-workflows.test.ts
bun --filter @appwithai/web test -- packages/generator/src/templates/__tests__/record-lifecycle-templates.test.ts
bun --filter @appwithai/web test -- packages/generator/src/templates/__tests__/workflow-step-values.test.ts
bun --filter @appwithai/web test -- packages/generator/src/workflows/__tests__/compile-sagas.spec.ts
bun --filter @appwithai/web test -- packages/editors/src/lib/eml/__tests__/workflow-hooks.test.ts
bun --filter @appwithai/web test -- packages/editors/src/lib/eml/__tests__/status-choices.test.ts
```

**What they hold:**
- `status-bound-workflows.test.ts` — `ENTER:<STATE>` compiles from `status:`,
  migration widens column, service validates state against drawn edges,
  two-transaction press structure, failed run persisted after rollback
- `record-lifecycle-templates.test.ts` — lifecycle module generates correctly
  (state columns, terminal states, Reopen, cache TTLs)
- `workflow-step-values.test.ts` — formula variable resolution, create step
  interpolation, decision on `%%rule`, emptied fields → null
- `compile-sagas.spec.ts` — `sagaOperation()` for `ENTER:` compilation

#### 2. Rule & Workflow Editor E2E (Modelling Tool)

```bash
# All editor specs against the modelling tool
bun run test:e2e:rules-workflows

# Individual specs:
cd scripts/e2e-rules-workflows
bunx --bun playwright test -c playwright.config.ts specs/01-business-rules-editor.spec.ts
bunx --bun playwright test -c playwright.config.ts specs/02-workflow-editors.spec.ts
bunx --bun playwright test -c playwright.config.ts specs/03-graph-rules.spec.ts
```

| Spec | What it tests | Duration |
|------|---------------|----------|
| `01-business-rules-editor` | 41 decision table rules, all operators, try-it panel | ~30 min |
| `02-workflow-editors` | 50 workflows: lifecycle hooks, state machines, processes | ~15 min |
| `03-graph-rules` | 11 graph rules (Expression, Function, Switch nodes) | ~10 min |
| `14-qa-process-every-step` | All step types, 59-step process, lifecycle hooks with rules | ~30 min |

**Do not run specs 01–04 together** — they starve the dev server. Run one at a time.

#### 3. Rule & Workflow Editor E2E (Generated App)

```bash
# Point the editor specs at a generated app's Admin → Rules and workflows
LOGIC_TARGET=generated bun run test:e2e:rules-workflows -- specs/01

# Full generated-app flow (generates, boots, and drives the app):
bun run test:e2e:rules-workflows -- --generated specs/12-generated-state-machine.spec.ts
bun run test:e2e:rules-workflows -- --generated specs/15-qa-generated-run.spec.ts
```

| Spec | What it tests | Needs |
|------|---------------|-------|
| `12-generated-state-machine` | Drawn moves accepted, undrawn refused, `/api/workflows/transitions` | `--generated` + `DATABASE_URL` |
| `15-qa-generated-run` | 59-step process running on real records, hook refusals, web calls | `--generated` + model from spec 14 |

**`--generated` creates `<db>_rules_workflows_e2e`** beside the configured
database, never touching the tool's own database.

#### 4. Generated App's Own Suites

These run inside the generated application (via `appwithai generate … --run-tests`
or `bun run test:e2e` in the output directory):

| Suite | What it holds |
|-------|---------------|
| `05-rules` | Rule enforcement per entity: marker values, preventing writes |
| `06-rules-workflow` | Basic rule enforcement + workflow runs logged |
| `06b-workflow-transitions` | State machine edges: drawn accepted, undrawn refused, BFS walk |
| `06c-status-bound-workflow` | Two-transaction button press: failed bound workflow → 422, typed values survive, retry succeeds |
| `15-record-lifecycle` | Every entity: promotion on create, `doc_status`, locked Final records |
| `20-optimistic-locking` | `ETag` / `If-Match` version conflict detection |
| `22-optimistic-locking` | API-level version conflict (parallel writes) |

**Run every suite twice on one database** before calling it done — unique
constraints and seeded constants behave differently on repeat runs.

#### 5. WASM Browser Stack

```bash
# Needs PGlite and stack templates placed first:
bun run vendor:pglite
bun run build:stack-templates
bun run test:wasm
```

`tests/e2e/wasm/browser.e2e.spec.ts` chapter 09 covers workflow state machines
and access control in the browser stack.

### QA Flow: Testing a Lifecycle Change End-to-End

This is the manual flow for verifying that a lifecycle state machine, its
workflows, and its rules all work together.

#### Step 1: Verify the Model

```bash
bun language/checker.ts path/to/model.eml.mmd
# Must pass with 0 errors
# Check: EML243 (status must be drawn), EML244 (only update may start),
# EML245 (some arrow must lead into state)
```

#### Step 2: Generate and Build

```bash
bun run wasm generate -i path/to/model.eml.mmd -o /tmp/test-app --force
cd /tmp/test-app
bun install
bun run dev
```

#### Step 3: Verify Lifecycle Behaviour

For each entity with a state machine:

1. **Create a record** → verify it lands in Draft (`doc_status: 'draft'`)
2. **Check promotion** → verify it moves to `afterDraft` (first flow state)
3. **Check action buttons** → `GET /bus/:entity/:id/actions` lists only valid
   moves from the current state
4. **Press each button in order** → verify:
   - Status moves to the target state
   - `<state>_at` timestamp is set
   - Transition logged in `sys_record_transitions`
   - Bound workflows run (check `sys_workflow_runs`)
5. **Try an invalid transition** → verify 409 `INVALID_TRANSITION`
6. **Reach a terminal state** → verify the record is locked (409 `RECORD_FINAL`
   on edit or delete)

#### Step 4: Verify Workflow Binding

For each workflow with `ENTER:<STATE>`:

1. **Move a record to the bound state** via button press
2. **Verify the workflow ran** → check `sys_workflow_runs` for the record
3. **Introduce a failure** (e.g. a REST step to a bad URL)
4. **Press the button again** → verify:
   - 422 `WORKFLOW_FAILED` with `details.workflow` and `details.phase`
   - Form values saved (version incremented)
   - Status did NOT move
   - Error in `doc_status_message`
   - Failed run in `sys_workflow_runs`
5. **Fix the cause and retry** → verify the move succeeds this time

#### Step 5: Verify Rules

For each entity with rules:

1. **Create a record that triggers a `prevent` rule** → verify 422 rejection with
   the rule's message
2. **Create a record that triggers a `transform`** → verify the field was modified
3. **Create a record that triggers `trigger-workflow`** → verify the named process
   started (check `sys_workflow_runs`)
4. **On a button press:** create a record whose after-move state trips a refusing
   rule → verify 422 and the move is blocked

#### Step 6: Verify RBAC

For each `%%rbac` grant:

1. **Sign in as a role with the grant** → verify the button is present and works
2. **Sign in as a role without the grant** → verify the button is absent or
   returns 403 `TRANSITION_FORBIDDEN`
3. **Reopen:** verify only the administrator can reopen (unless a grant says
   otherwise)

#### Step 7: Verify the Two-Transaction Pattern

1. Fill in form values + press a status button
2. If the bound workflow fails (422):
   - Reload the record → form values are saved
   - Version is old + 1
   - Status is unchanged
   - `doc_status_message` shows the reason
3. Fix the issue and press the button again → status moves

### Fixture Model

`tests/test-data/dance-studio-workflows.eml.mmd` carries all 25 behaviour
constructs. Use it when changing parsers, compilers, or the checker. It exercises:
both `%%rule` shapes, all 3 `%%action` types, 4 state machines,
transition-level `%%rbac`, all 3 `%%trigger` sources, every `%%hook` event,
every saga `%%step` type, and a bounded `%%loop`.

### Adding New Test Cases

- **New rule scenario:** add object to
  `scripts/e2e-rules-workflows/scenarios/rule-catalogue.ts`
- **New workflow scenario:** add object to
  `scripts/e2e-rules-workflows/scenarios/workflow-catalogue.ts`
- Controls are found by on-screen labels (never by position), so new inspector
  fields don't break existing scenarios.

---

## Design Rules of Thumb

1. **Rules never write.** GoRules produces values; workflows write them.
2. **Buttons move records, saves do not.** A save puts a record in Draft; only a
   button press moves it along its flow.
3. **One transaction per transition.** The button press saves form data
   (transaction 1), then moves status + runs workflows (transaction 2). Failure
   in 2 never loses 1.
4. **Workflows bind to the next state.** `ENTER:<STATE>` means "run this when the
   record enters that state via any button press".
5. **Terminal states are locked.** A record in a terminal state cannot be edited
   or deleted (409). Only Reopen (if granted) can move it back.
6. **Side effects that must not roll back** (emails, non-idempotent REST calls)
   should be modelled as post-commit steps or follow-up processes.
7. **The state field is system-managed.** A form save that tries to write the
   state field gets 403 `STATE_FIELD_SYSTEM_MANAGED`. Only transitions write it.
8. **`afterDraft` is the first flow state**, not "final". On promotion, a record
   with a state machine lands at the machine's initial state.
9. **`doc_status` is the phase, the state field is the position.** `doc_status`
   is `draft`/`active`/`final`/`error`; the state field (`status`/`state`/`stage`)
   is the business position within the flow.
