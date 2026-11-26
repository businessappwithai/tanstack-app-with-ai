# Workflows started by a hook *and* a status

## Context

Today a workflow in the Logic workbench (`packages/editors`) starts from **one hook** only, such as `afterUpdate on Contract`. Nothing in the editor, the EML language or the generator can say "run this workflow when the Contract is updated **and its status becomes To be reviewed**".

The generated NestJS runtime already does most of the hard part:
- `TransitionService.move` (`backend/src/modules/bus/transition.service.ts.hbs:236-424`) runs a button press in one DB transaction.
- That transaction includes the row lock, the version check, the edge check, the grant check, the refusing rules and the state write.
- It then runs workflows whose `operation` is `UPDATE`, `TRANSITION:<EVENT>` or `ENTER:<STATE>` (`workflow.service.ts.hbs:130-173`).
- If any workflow throws, it rolls back and returns **422 `WORKFLOW_FAILED`**: "*"To be reviewed" did not go through: … The record is still "draft"*".

What is missing:
1. **Nothing writes an `ENTER:<STATE>` binding.** No editor control, no EML syntax, no compiler and no seed produces one.
2. **The `operation` column is too short.** It is `varchar(20)` (migration 004), so `ENTER:TO_BE_REVIEWED` would not fit.
3. **Button names come from the arrow label** ("Submit"), not from the status the button moves to.
4. **A failed press is a toast that disappears.** The workflow's error is not kept anywhere a user can see.
5. **The browser (WASM) stack has no transaction around a move.** It commits the status first, then runs processes, and a failure leaves the status moved.

**Goal.** A workflow carries `hook + status`. A button press is **two transactions** (see "The button press: two transactions" below):
1. **Transaction 1 saves the form**, and the record stays in its current status.
2. **Transaction 2 runs the workflows attached to the target status** and, if they all succeed, moves the record to that status.
   - **Success:** the record is in the new status.
   - **Failure:** transaction 2 is rolled back. The saved form data stays, the status stays where it was, and the error is shown on the record and in Run History.

This holds for entities **with** a status machine and for entities **without** one (which get the two default statuses Draft and Final), on both stacks.

Decisions you confirmed:
- **Buttons are named after the target status.** The arrow label stays as the event key for `%%rbac` and logs.
- **Both stacks** (NestJS and browser/WASM) are in scope.

---

## Screens: wireframes

Plan mode does not let me start the app (Postgres, dev server, writes), so these are wireframes of the real screens. **Step 0 of implementation captures real "before" screenshots, and the last step captures real "after" ones.** Both sets go into `docs/screenshots/workflow-status/` and are published as one before/after page.

### A. New workflow panel (Logic step and Admin → Rules & workflows)

Before:
```
┌ New workflow ───────────────────────────────┐
│ Name      [ Contract review              ]  │
│ Entity    [ Contract                   ▾ ]  │
│ Hook      [ After update               ▾ ]  │
│                                             │
│                       [ Cancel ] [ Create ] │
└─────────────────────────────────────────────┘
```
After (the status picker appears when the hook is an update hook and the entity has a status machine):
```
┌ New workflow ───────────────────────────────┐
│ Name      [ Contract review              ]  │
│ Entity    [ Contract                   ▾ ]  │
│ Hook      [ After update               ▾ ]  │
│ Status    [ To be reviewed             ▾ ]  │
│           ├ Any update (no status)         │
│           ├ Draft                          │
│           ├ To be reviewed   ◀            │
│           ├ Approved                       │
│           └ Signed                         │
│  Runs when a Contract is moved to "To be   │
│  reviewed" by its button. If any step      │
│  fails, the move is undone and the record  │
│  stays where it was.                       │
│                       [ Cancel ] [ Create ] │
└─────────────────────────────────────────────┘
```
If the entity has no status machine, the picker is **disabled**, shows **Final**, and carries the note: *"Contract has no status flow. By default it has two statuses, Draft and Final. Pressing the button saves the Contract; another transaction then runs this workflow, which moves the status to Final. A Contract with a status flow works the same way: the button saves the form in its current status, then the workflows attached to the next status run, and if they succeed the status moves on, in a separate transaction."*

```
│ Status    [ Final                    🔒 ]  │   (disabled)
│  Contract has no status flow. By default   │
│  it has two statuses, Draft and Final.     │
│  The button saves the Contract; another    │
│  transaction then runs this workflow and   │
│  moves the status to Final.                │
```

### B. Workflow header sentence and trigger panel (AutomationBuilder)

Before (process, automatic):
```
What starts it   [ The record's own lifecycle ▾ ]
On which write   [ Updated                    ▾ ]
"When a Contract is updated"
```
After:
```
What starts it   [ The record's own lifecycle ▾ ]
On which write   [ Updated                    ▾ ]
When the status  [ To be reviewed             ▾ ]
becomes
"When a Contract is updated and its status becomes To be reviewed"
```
A lifecycle (hook) workflow shows the same **When the status becomes** picker above its ladder. While a status is set, the ladder offers only `beforeUpdate` / `afterUpdate` rungs.

### C. Status machine editor: who runs on entering a state (read-only badge)
```
 ( Draft ) ──submit──▶ ( To be reviewed ) ──approve──▶ ( Approved )
                         ⚙ Contract review
```

### D. The record in the generated app

Before (button named after the arrow; a failure is only a toast):
```
Contract CT-0042                    Draft
[ Submit ]  [ Cancel ]
                                   ┌──────────────────────────┐
                                   │ ✕ "Submit" did not go …  │  (vanishes)
                                   └──────────────────────────┘
```
After, on success:
```
Contract CT-0042                    To be reviewed
[ Approved ]  [ Draft ]
✓ Moved to To be reviewed · ran: Contract review
```
After, on failure (the form was saved, the status is unchanged and the error stays on the record):
```
Contract CT-0042                    Draft
[ To be reviewed ]  [ Cancelled ]
┌ ⚠ "To be reviewed" did not go through ───────────────────────┐
│ Your changes were saved. Workflow "Contract review" failed   │
│ at step "Create review task": reviewer_id is required, so    │
│ the record is still Draft. Fix it and press the button again. │
│                                   [ Open run history ]        │
└───────────────────────────────────────────────────────────────┘
```
No status machine, on failure:
```
Contract CT-0042                    Draft
[ Save ]
┌ ⚠ Saved, but not made Final ──────────────────────────────────┐
│ Workflow "Contract approval" failed: … The record stays Draft. │
└────────────────────────────────────────────────────────────────┘
```

---

## Design

### The button press: two transactions

| | With a status machine | No status machine (default Draft → Final) |
|---|---|---|
| The button | One per arrow out of the current status, named after the target status ("To be reviewed") | The form's Save button |
| **Transaction 1** | Save the form's values. The status column is not touched, so the record stays in its current status. The save's own refusing rules apply; a refusal ends the press here (422 `RULE_REFUSED`, nothing saved) | Save the form's values; the record is in Draft |
| Commit | Transaction 1 commits, giving a new `version` | same |
| **Transaction 2** | `TransitionService.move` on the saved record: lock, version, edge, grant, refusing rules, then the workflows bound to `ENTER:<target>` (plus `TRANSITION:<event>`), then write the status and `<state>_at` | `EntityPromotionService`: rules, then the entity's `CREATE`/`UPDATE`/`ALL` workflows, then `doc_status = final` |
| Success | Status = target; `doc_status_message` cleared | `doc_status = final` |
| Failure | Transaction 2 rolls back. The **saved values from transaction 1 stay**, the status stays at the previous one, and 422 `WORKFLOW_FAILED` is returned. The failed run and `doc_status_message` are written after the rollback | Transaction 2 rolls back. The saved values stay, the record stays **Draft** (not Final), and the reason goes to `doc_status_message` and the failed run |

Why two transactions: the person's typing is never lost to a failing workflow. They fix the data or the workflow's precondition and press the button again; the second press saves (a no-op if nothing changed) and retries transaction 2.

**Where the two transactions are joined: the backend, not the browser.** `POST /bus/:e/:id/transition` gains an optional `data` field.
- With `data` (and `If-Match`), the controller first calls `busService.update` (transaction 1, which commits and returns the new version), then `transitionService.move` with that version (transaction 2).
- Without `data` it behaves exactly as today, so existing callers, sagas' `UpdateEntity` and suite `06b` are unaffected.
- Doing both in one request means one `If-Match`, and no window in which another person's save lands between the two.
- The response says which phase failed: `details.phase: "save" | "workflow"`. On a `workflow` failure it carries the new `version`, so the form refreshes its ETag; the save did happen.

**No status machine.** The entity has two default statuses, Draft and Final. `EntityPromotionService` already does "save commits, then one transaction runs rules and workflows and moves Draft → Final". So every update or create workflow on such an entity is *already* "the workflow that moves it to Final".
- That is why the picker is disabled and shows Final. The workflow is stored as today (`UPDATE`/`CREATE`/`ALL`, no `ENTER:` binding), and no new syntax is needed for this case.
- The one behaviour change: on a **workflow** failure, promotion leaves the record in **Draft** with the reason in `doc_status_message` and the failed run recorded.
- Today it marks the record `error`; that marking stays only for a refusing rule. The code tells the two apart by `WorkflowRunError` vs. a rule refusal.

`statesFor(entity)` returns `{ fixed: "final" }` for such an entity, which drives the disabled picker.

**With a status machine.** `final`/`error` cannot be state names there (EML509), so there is no clash. The machine's states are offered, except the initial one (EML299).

### Model / EML

There is one new optional option on `%%workflow`: **`status: <state>`**. It is valid for `kind: hook` and `kind: saga`:
```
%%workflow ContractReview entity: Contract kind: saga trigger: automatic operation: UPDATE status: to_be_reviewed
%%workflow ContractReviewHooks entity: Contract kind: hook status: to_be_reviewed
```

Meaning: the workflow runs only in transaction 2 of a press whose target is `<state>`. On an entity with no machine, `status:` is not written; its workflows already run in transaction 2 and move it to Final. It does not run in transaction 1, the save. A workflow with no `status:` behaves exactly as today.

It is stored as `operation = 'ENTER:<STATE>'`, which the runtime already matches. A move already runs `update`, then `transition:<event>`, then `enter:<to>`.

### Checker

New codes in the EML2xx range. None is auto-fixable.
- **EML297 (error):** `status:` names a state the entity's `kind: state` machine does not declare, or the entity has no machine. With no machine, the workflow already runs on the way to Final, so `status:` is meaningless there.
- **EML298 (error):** `status:` on a saga whose operation is not `UPDATE`, or on a hook workflow carrying a rung that is not an update hook.
- **EML299 (warning):** `status:` names the machine's initial state, or a state no drawn arrow enters, so the workflow can never run.

Before using these numbers, check they are free in `language/checker.ts` and `appwithai-language.json`.

### Button names

`lifecycleMoveLabel(event, to)` (`generators/tanstack-start-nestjs/lifecycle-module.ts:143`) returns the **target state's name** ("To be reviewed"), always. The event still identifies the move (`%%rbac`, `sys_record_transitions`, `{event}` in the POST). Reopen stays "Reopen".

The browser twin is `templates/wasm/server/lib/lifecycle.js`. `language/appwithai-language.json` `stateForm.moves` changes its wording to match.

### Error, populated

When a move fails, four things record or show it:
1. **The 422 response:** `WORKFLOW_FAILED` gains `details.workflow` and `details.step`. Today it has only the message.
2. **`sys_workflow_runs`:** the failed run is written with status `failed` and the step error **after** the rollback, in its own statement, the way `sys_record_transitions` is already written outside the transaction (`transition.service.ts.hbs:250-258`). Run History then shows it.
3. **`doc_status_message`:** set to the reason without bumping `version`, so the record shows it after a reload. The next successful move already clears it (L323-336).
4. **`record-actions.tsx`:** keeps an inline alert (screen D) until the next press, instead of `toast.error` alone.

---

## Implementation steps

### 0. Before screenshots
Use the `run-modelling-tool` skill:
- Capture the Logic step's New workflow panel, a process trigger panel and a status machine.
- Use `generate-and-run-app` with `examples/crm.eml.mmd` (or a small Contract fixture) to capture the record action buttons and a failing move's toast.
- Save the images to `docs/screenshots/workflow-status/before-*.png`.

### 1. Language (`language/`)
- **`appwithai-language.json`:** add `status:` to the forms of `workflowKinds.saga` and `workflowKinds.hook`; add EML297–299; reword `stateForm.moves`.
- **`composer.ts`:**
  - Add `status?: string` to `EmlWorkflowSection`.
  - Make `emitWorkflowSection` write ` status: <s>` for hook and saga kinds.
  - Make `extractWorkflowSections` read `/\bstatus:\s*(\w+)/` and normalise it with the same `oneToken` rule as state names.
- **`checker.ts`:**
  - Add EML297–299 beside EML240–242. Reuse the state-edge parse the checker already does for `kind: state`.
  - Add the codes to the docs table.
- **`move-facts.ts`:** EML512 must not retire a `status:`-bound saga. Add a guard and a test case.
- **Example:** add one `status:`-bound process to `tests/test-data/dance-studio-workflows.eml.mmd`, the fixture that carries every behaviour construct.
- **Docs:** update `website/llmtext/` (`eml-syntax.txt`, `checker-rules.txt`), then copy the changes to the orchestrator and the website (noted in the PR as follow-up for the other repositories).

### 2. Editors package (`packages/editors/src`)
- **`lib/automation/model.ts`:**
  - Add `status?: string` to `Automation`.
  - `serializeAutomation`: write `status:` in the saga positional header.
  - `serializeHookWorkflow`: carry it on the `%%workflow` line for the hook kind.
  - `parseAutomation`: read `status:` in both forms.
  - Sentence helpers (`AutomationBuilder.tsx:1025-1120`): add "…and its status becomes X".
- **`lib/eml/workflow-model.ts`:** `StoredWorkflow.status`; `toEditableWorkflow` and `workflowForSave` carry it for both kinds.
- **`lib/eml/workflow-hooks.ts`:**
  - `STATUS_HOOKS = ["beforeUpdate","afterUpdate"]`.
  - `statusOperation(status)` returns `ENTER:${status.toUpperCase()}`.
  - `statusFromOperation(op)` does the reverse.
  - `statesFor(entity, workflows)` returns the states of that entity's `kind: state` workflow (or `undefined`), using `parseStateFlow`/`workflow.states`.
- **`components/eml/NewWorkflowPanel.tsx`:** add `status?: string` to the draft and a **Status** `<select aria-label="Status">` (screen A). It is disabled unless the hook is in `STATUS_HOOKS` and `statesFor` returns states.
- **`components/LogicWorkbench.tsx`:**
  - `createWorkflow` copies `draft.status` into `automation.status`.
  - Pass `statesFor` down to the panel, the builder and the status canvas.
  - `ConstraintWorkflow` already has `stateNames`; reuse it.
- **`components/automation/AutomationBuilder.tsx`:** add a **When the status becomes** select:
  - in the saga trigger block (shown when `automatic` and `UPDATE`);
  - in the hook workflow header;
  - restrict the ladder's hook choices to `STATUS_HOOKS` while a status is set (screen B).
- **`components/eml/WorkflowEditor.tsx:344-358`:** the Show EML preview writes `status:`.
- **`StateFlowCanvas.tsx`:** read-only badge listing the workflows bound to each state (screen C).
- **`lib/eml/section-problems.ts`:** refuse saving a workflow whose status is not one of the entity's states, or is set with a non-update hook or operation. These are the same three conditions as the checker, in editor words.
- **`WorkflowRules.tsx`:** add a note under a status-bound workflow: *"Rules attached here run on every update; the status applies to this workflow's steps."* Rules keep their own event.
- **Help:**
  - `content/help/lifecycle.md` and `process.md` get a "Started by a hook and a status" section covering the one-transaction, rollback and error behaviour.
  - `status.md` says buttons are named after their status, and explains the badge.
  - `help-content.test.ts` requires "When the status becomes" in both pages.

### 3. Modelling-tool host (`packages/web`)
- `routes/api/projects/$id/eml.ts` already round-trips through `mergeSections` / `extractWorkflowSections`, so composer step 1 covers it.
- Confirm `sectionProblems` runs server-side with the new checks.
- No new route, so no `PROJECT_ROUTES` change.

### 4. Generator (`packages/generator/src`)
- **`workflows/steps.ts`:**
  - Add `status?: string` to `CompiledSaga`.
  - `compileSagas` sets `operation = status ? "ENTER:" + STATUS.toUpperCase() : section.operation ?? "CREATE"`. Widen the type to `SagaOperation | \`ENTER:${string}\``.
- **`nestjs-backend.generator.ts:~2030`:** the seed writes that operation.
- **Hook-kind workflows declared in the model:** confirm how they reach `sys_workflow_definitions`. The hook executor is not invoked from `bus`/`transition` today; only definitions with `bpmn_xml` run. If they are not seeded as runnable rows, `status:` on a model `kind: hook` is reported by the checker as **info**: "binds the workflow's steps; handler modules are not called by a move". Do not build a new hook dispatch.
- **`rules/model-logic.ts` / `MODEL_WORKFLOWS`:** carry `status` so locked model workflows display it.
- **`lifecycle-module.ts`:** apply the `lifecycleMoveLabel` change, and update the assertions that pin old labels:
  - `record-lifecycle-templates.test.ts`
  - suites `06b` and `15`
  - e2e `12-generated-state-machine`
- **`wasm/model-bundle.ts`:** `model.json` sagas carry `status`.

### 5. Generated NestJS templates (`templates/tanstack-start-nestjs/`)
- **New migration `024_widen_workflow_operation.ts.hbs`:** `ALTER COLUMN operation TYPE varchar(80)` on `sys_workflow_definitions`. **Add the slug to the `scaffold` array** in `generateMigrations`.
- **`workflow-definitions.service.ts(.hbs)`:**
  - Accept `operation` matching `^(CREATE|UPDATE|DELETE|ALL|ENTER:[A-Z0-9_]+|TRANSITION:[A-Z0-9_]+)$`.
  - Reject `ENTER:X` when X is not a state of the entity's machine (400 with the reason).
  - Fix the narrow type at L32.
- **`frontend/src/lib/logic-host.ts`:**
  - `operationOf` returns `statusOperation(status)` when `automation.status` is set.
  - `toStoredWorkflow` reads `ENTER:` back into `status`, for both hook and saga rows.
  - `MODEL_WORKFLOWS` states feed `statesFor`.
- **`bus.controller.ts.hbs` `POST :entity/:id/transition`:**
  - Accept an optional `data`.
  - With it: `busService.update(entity, id, data, ifMatch)` (transaction 1, committed), then `transitionService.move(..., expectedVersion = saved.version)` (transaction 2).
  - Answer with `details.phase`, and with the saved record's version and ETag on a workflow failure.
  - The state field is still refused in `data` (403 `STATE_FIELD_SYSTEM_MANAGED`).
- **`bus.service.ts.hbs` `update`:** status-bound workflows (`ENTER:*`) are never selected on a save. `runInTransaction` part-way along a flow already selects by `UPDATE`/`ALL` only; add a test that pins it.
- **`entity-promotion.service.ts.hbs` (no status machine):**
  - Selection is unchanged (`findWorkflowNames` L467-490).
  - On a `WorkflowRunError`, roll back, leave `doc_status = draft`, and write `doc_status_message` and the failed run. Keep `markError` for refusing rules.
- **`transition.service.ts.hbs`:**
  - Catch the failure with the failing workflow and step. `workflow.service.runLocalWorkflows` with `throwOnError` throws a typed `WorkflowRunError {workflow, step, message, runId}` instead of a plain string.
  - Put both in `details`.
  - After the rollback, write the failed `sys_workflow_runs` row and `doc_status_message` (no version bump).
- **`workflow.service.ts.hbs`:** add the `WorkflowRunError` class, and keep the run-row data for the post-rollback write. Leave the selection logic alone; it already matches `ENTER:`.
- **`frontend/src/components/admin/record-actions.tsx` + `ad-detail-shell.tsx`:**
  - A button press sends the form's current (dirty) values as `data`, with the transition in one request.
  - With no status machine, the form's Save does the same through the existing save path (promotion is already transaction 2).
  - On `phase: "workflow"`, keep the form's values, take the new version, and show the alert.
  - Show an inline `Alert` for 422 `WORKFLOW_FAILED` / `RULE_REFUSED` (screen D) with a link to the run's history.
  - On success, show "Moved to X · ran: …" from `ranWorkflows`.
- **Run History:** confirm the screen lists `failed` runs with their step error. Add the error column if it is missing.

### 6. Browser stack (`templates/wasm/`)
- **`server/modules/bus.routes.js` `POST /:entity/:id/transition` (L738-850):**
  - Accept `data`: save first through the existing update path (transaction 1, committed), then run the move.
  - Wrap the move's version check, rule check, update and sagas in `db.transaction(...)` (transaction 2).
  - With no status machine, the save route's Draft → Final step runs the entity's update sagas in a transaction and leaves the record Draft on failure.
  - Select sagas for `ENTER:<to>`.
  - On a saga failure, throw so the transaction rolls back, then answer 422 `{message, details:{code:"WORKFLOW_FAILED", workflow, step, from, to}}`.
  - Record the failed run and `doc_status_message` after the rollback.
- **`server/lib/sagas.js`:**
  - `runTriggeredSagas` gains an `enter` selection (`saga.operation === "ENTER:" + to.toUpperCase()`).
  - `runSaga` gets a `throwOnError` mode that rethrows instead of marking the run failed and continuing.
  - Mutations go through the transaction's `db`.
- **`server/lib/workflows.js`:** let the admin route accept the `ENTER:` operation for `sys_workflow_definitions`.
- **`server/lib/lifecycle.js`:** label by target state.
- **`ui/views/entity-form.js`:** inline failure panel (no modal, since the app runs in an iframe).
- **`sw.js`:** no change. A 422 has a body.
- Run `bun run build:wasm-runtime`.

### 7. Committed artifacts (Bun 1.4.4 on linux-x64; this container qualifies)
Rebuild every artifact whose sources this change touches, then run all five `--check`s:
- `build:wasm-runtime` (`templates/wasm`)
- `build:wasm-browser`
- `build:fullstack-browser` (anything under `generator/src` or the templates)
- `build:language-tools` (`language/**`)
- `build:viewers`

### 8. After screenshots and the write-up
- Repeat step 0 on the changed build, plus the failing-move alert and Run History's failed run.
- Write `after-*.png` beside the "before" images.
- Publish a before/after page and link it in the PR.
- Add a CLAUDE.md section, "A workflow is started by a hook and a status", covering the binding, the transaction and where the error lands.

---

## Tests

**Unit tests (bun run test)**
- **`editors/lib/automation/__tests__/status-binding.test.ts`:**
  - parse/serialize round trip for saga and hook forms;
  - `operationOf` gives `ENTER:TO_BE_REVIEWED`;
  - `toStoredWorkflow` reads it back.
- **`checker-accepts-automations.test.ts`:** the checker accepts what the builder writes with `status:`.
- **`section-problems.test.ts`:** an unknown status, a status on a create hook, and a status on an entity with no machine.
- **`generator/src/workflows/__tests__/compile-sagas.spec.ts`:** `status:` compiles to `ENTER:…`. Assert against the runtime's selection rule (`operation.toUpperCase()`), not the compiler's own output.
- **`language` composer round trip:** add the first test of `emitWorkflowSection`/`extractWorkflowSections` (none exists).
- **`templates/__tests__/record-lifecycle-templates.test.ts`:**
  - the migration slug is in `scaffold`;
  - the transition service writes the failed run after rollback;
  - labels come from the target state.

**Generated-app suite**
- New suite **`06c-status-bound-workflow`**:
  - **Success case:** a process bound to `ENTER:<state>` creates a child record. The move gives 200, the status moves, the child exists and the run succeeded.
  - **Failure case:** the process deliberately fails (e.g. it creates a row missing a required field). The press sends `data` with a changed field, and gets 422 `WORKFLOW_FAILED` with `details.phase = "workflow"`, `details.workflow` and `details.step`.
    - The changed field **is saved** (transaction 1 committed), and `version` went up by exactly one, for the save.
    - The status is unchanged, no child exists, the failed run is in `sys_workflow_runs` and `doc_status_message` is set.
  - **Save refused:** the press sends `data` a refusing rule rejects. It gets 422 `RULE_REFUSED` with `phase = "save"`; nothing is saved and no workflow ran.
  - **No status machine:** on an entity without a flow, its update process runs in transaction 2 after the save. On success `doc_status = final`; on failure the values are saved, `doc_status = draft` and the reason is set.
  - **Not bound to saves:** a plain form save does not run the bound process.
  - Run the suite twice on one database, per CLAUDE.md.
- The same assertions in `scripts/ci/wasm-smoke.ts` for the browser stack.

**E2E**
- Extend `scripts/e2e-rules-workflows/specs/02-workflow-editors.spec.ts`: create a workflow with Hook = After update and Status = To be reviewed, save, reload, and the status is still chosen.
- Add a spec that boots a generated app (`--generated`), presses **To be reviewed**, and sees the alert on failure, then the new status after fixing the data.

## Verification
1. Run `bun install`, `bun run type-check`, `bun run type-check:language`, `bun run test`, `bun run test:language-tools` and `bun run test:llmtext`.
2. Run the five `--check` artifact comparisons, all clean.
3. Run `bun run wasm generate -i <fixture> -o /tmp/x` and confirm the overlay footprint still holds.
4. Generate the NestJS app from the fixture with `--run-tests`; suite `06c` and the existing `06b`/`15` must pass.
5. In Chromium, in the generated app, press **To be reviewed** on a record twice: once with data that makes the process fail (status stays, alert shows, Run History shows the failed run), once with valid data (status moves).
6. Run the `ship-checks` skill before committing to `claude/workflows-hook-status-logic-h14rli`.

## Critical files
- `packages/editors/src/components/eml/NewWorkflowPanel.tsx`, `components/LogicWorkbench.tsx`, `components/automation/AutomationBuilder.tsx`, `lib/automation/model.ts`, `lib/eml/{workflow-model,workflow-hooks,section-problems}.ts`
- `language/{composer,checker,move-facts}.ts`, `language/appwithai-language.json`
- `packages/generator/src/workflows/steps.ts`, `generators/tanstack-start-nestjs/{lifecycle-module,nestjs-backend.generator}.ts`
- `templates/tanstack-start-nestjs/backend/src/modules/{bus/transition.service,workflow/workflow.service}.ts.hbs`, `migrations/024_widen_workflow_operation.ts.hbs`, `frontend/src/lib/logic-host.ts`, `frontend/src/components/admin/record-actions.tsx`
- `templates/wasm/server/{modules/bus.routes.js,lib/sagas.js,lib/lifecycle.js}`, `ui/views/entity-form.js`
