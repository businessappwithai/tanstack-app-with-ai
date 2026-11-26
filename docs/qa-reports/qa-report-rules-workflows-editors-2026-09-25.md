# QA Report: the Logic step's rule and process editors, on the education model

| Field | Value |
|-------|-------|
| **Date** | 2026-09-25 |
| **URL** | `http://localhost:3000/projects/:id/logic` (the modelling tool, `bun run dev`) |
| **Branch** | `claude/test-rules-workflows-editor-3d0gqi` |
| **Model** | `docs/eml-sessions/education-management-system/education-management-system.mmd` (19 entities, 10 rules, 22 processes) |
| **Scope** | Every input of the business-rule editor and the three process editors (Lifecycle, Status, Process), added through the browser, saved, reloaded, and the saved model checked |
| **Framework** | TanStack Start + React 19, React Flow for the status canvas, PostgreSQL 16 + pgvector |
| **Screenshots** | 14, under `screenshots/rules-workflows/` |

## Method

The run used **Chromium through Playwright**, not gstack's `$B` browser, for the
same reason as the 2026-09-09 report: gstack's installer is not available in this
session. It collects the same evidence and produces the same report with a
different driver. An ordinary approved account owned the project, not the
administrator, because the project routes refuse administrators.

Everything was entered through the page itself, with clicks, typing,
selections, and dragging on the status canvas. The API was used only to create
the project and to read back what was saved. The run is now a spec,
`tests/e2e/05b-logic-editors.e2e.spec.ts`, so CI repeats it on every pull
request.

## What the two editors are for

**The business-rule editor** records a decision the application makes on every
write to one entity. It is a decision table: inputs are the record's fields,
outcomes are what happens (`validation-error` refuses the write, `transform`
sets a field, `trigger-workflow` starts a process), and the first row that fits
wins. It compiles to a GoRules decision graph that runs inside the write.

**The workflow editors** record what happens around those decisions. There are
three kinds:

- **Lifecycle**: named handlers at fixed moments (`beforeCreate`, `afterUpdate`…),
  generated as stubs in `backend/src/modules/hooks/handlers/`.
- **Status**: the statuses a record moves through and the moves allowed. The
  generated guard refuses any other move.
- **Process**: ordered steps (check, repeat, look up a rule, create, update,
  delete, work out a value, call a web service), started by a rule or by the
  record's own lifecycle.

## Findings

| # | Severity | Editor | Finding | Status |
|---|----------|--------|---------|--------|
| 1 | High | Rule | A rule written as `%%action` lines (six of the education model's ten) opened read-only as a flowchart. The only offer was *Start an empty table instead*, which discards the actions. The Enhance page already read them as a table; the Logic page did not | **Fixed** |
| 2 | Medium | Rule | *Test with values* never matched a quoted value. The cell `"cancelled"` was unquoted before comparing and the typed `"cancelled"` was not, so the panel reported the catch-all row. The same bug was in the automation screen's table editor | **Fixed** |
| 3 | High | Process | The *Look up a rule table* picker was empty on the Logic page, so no process built there could consult any of the model's rules | **Fixed** |
| 4 | Low | Process | A repeat read *"until feeinvoice.status is not paid stops being true"*, a double negative | **Fixed** |
| 5 | High | Process | *Create a record* wrote its values as typed. Every line after the first fell outside the `%%step` directive (invalid Mermaid, dropped on reload), and the first was not JSON, which the generated `executeCreateEntity` requires, so the step was skipped at run time as "invalid fields JSON". A multi-line web-service body had the same line-escaping problem | **Fixed**, in both the tool and the builder copy it ships to generated apps |
| 6 | Medium | Rule | Saving an `%%action` rule moved its actions below the next section's heading (`%% ---- Business rules — the student record`), because a rule's body runs to the next `%%rule` and the actions were appended at its end | **Fixed** |
| 7 | High | Process | *Update a field* on the record the process runs on wrote `entity: FeeInvoice` with no target. The checker the generator runs reads that as a cross-entity write it cannot aim (EML265, an error), so the process failed the check. The executor treats a write with no entity as "this record", which is how the model's own sagas write it. The inspector now shows the own record type for a step that names none, and picking it stores no entity | **Fixed** |
| 8 | Medium | Process | *Update a field* on a **different** record type had no "Which record" input, so it could never be aimed at a row. The checker rejected it (EML265) and the executor skipped it | **Fixed**: `target` added to the step in the tool's builder, the generated app's copy and `appwithai-language.json`; the builder reports a cross-entity write that does not say which row |
| 9 | — | Status | A drag that starts within 200 ms of *Add state* misses, because the canvas is re-fitting | **Not a defect.** No person moves that fast; the spec waits for the canvas to settle |
| 10 | Low | Checker | On a status machine bound to an entity with no status column, EML426 names an unrelated enum (`AssessmentStatus`) | **Open.** `language/**`, outside this change |

### How finding 8 was closed

`target` was added to `UpdateEntity` in `STEP_FIELDS`, in both builder
copies (held equal by `generated-app-parity.test.ts`), and in
`appwithai-language.json` (held equal by `language-parity.test.ts`). The
generator and the checker already read `target:` in both of its forms: a
`{{reference}}` becomes the row id, a bare column a foreign key to match. So
the change is the input, the validation that asks for it, and the help that
explains it. `update-target.test.ts` holds the builder's validation and the
published checker to the same answer.

## Evidence

| Before | After |
|--------|-------|
| `02-banding-actions-read-only.png`: Admission Banding as a read-only flowchart | `20-fixed-banding-table.png`: the same rule as its six-row table |
| `04-rule-table.png`: *Row 2 fits* for `"cancelled"` / `50` | `21-fixed-test-values.png`: *Row 1 fits* |
| `11-process-all-steps.png`: *Missing a rule table*, *"until … stops being true"* | `22-fixed-process.png`: `lateFeeGuard` picked, *"while …"* |

The saved model, before and after (the Create step's values):

```
%%step s3 values: status: reported              ← before: second line escapes
student_id: {{feeinvoice.student_id}}

%%step s2 values: {"status":"reported","student_id":"student_id","severity":2}   ← after
```

After the fixes, the model saved by the full run of the spec checks with
**0 errors**. The only two warnings come from binding the test status machine
to `Room`, which has no status column.

## The generated application's editors

The education model was generated, migrated and run, then its editors were
driven in Chromium as its administrator. The rule and workflow editors a
generated application ships are the tool's own components. They had drifted,
so they are now held byte-identical by `editor-files-identical.test.ts`.
`AutomationHelp.tsx` is the one deliberate difference: each host renders help
in its own frame. Screenshots are `gen-before-*` and `gen-after-*`.

| # | Severity | Screen | Finding | Status |
|---|----------|--------|---------|--------|
| G1 | High | Automations | The builder's copy of the model split `url: https://…` at `https:`, so a web-service step reopened with no URL. It also wrote hook workflows without the steps after the hooks | **Fixed**: the tool's model ships unchanged |
| G2 | Critical | Automations | The update endpoint wrote every field but `mermaid_code`, so Publish never saved an automation's steps. There was no draft save either, so everything built there was lost on reload | **Fixed**: the update writes the document, edits save as debounced drafts, and a new automation starts inactive |
| G3 | High | Business Rules | *Create Business Rule* offered a hard-coded list (Patient, Claim, Account, Opportunity…) and none of the application's own entities | **Fixed**: read from the dictionary (`/sys/tables`, `/sys/columns?tableId=`), with field pickers on new and edit |
| G4 | Critical | Business Rules | The editor saves a bare decision table; the engine needs a JDM graph, and answered "missing field `nodes`". Every rule created, or re-saved, in the editor refused nothing | **Fixed**: the engine wraps a stored table in a graph, quoting outcome text so `validation-error` is not read as a subtraction |
| G5 | High | Business Rules | The editor offers EML's `validation-error`, which the engine's `validate()` does not read. It refuses a write only on `prevent` | **Fixed**: the engine translates it |
| G6 | High | Business Rules | PostgreSQL returns NUMERIC as `"1.500000"`, and an update is checked against the stored row, so `> 0` never fit and a rule that held on create let the same write through on update | **Fixed**: the dictionary's number columns are compared as numbers |
| G7 | Critical | Report Designs | *Edit Design* changed the address and left the list on screen, because the child route had no `<Outlet />`. No entity's print layout could be customised | **Fixed** |
| G8 | Medium | Print | Dates printed as midnight timestamps; NUMERIC printed as `1.500000` | **Fixed**: printed by column type |
| G9 | Low | Dictionary hooks | `useTableColumns` filters with `table_id`, which the backend ignores, so it returns every table's columns | **Open**: outside the editors; the rule editor's new hook uses `tableId` |

Verified end to end in the browser. *Late Fee Guard* was created in Admin →
Business Rules on Fee Invoice; cancelling an invoice with a balance then
answers **400 "An invoice with a balance cannot be cancelled."** (it answered
200 before G4 to G6). An automation built in Admin → Automations comes back
whole after a reload. The report designer opens, saves a customised layout and
prints a real record for **all 19** entities.

CI's *Generate an application and build it* job was reproduced locally on
`drug-discovery.eml.mmd`: the backend, frontend and test-suite builds pass,
the migration runs, and **61/61** generated suites pass against Postgres with
these changes.

## Help, from Markdown files shipped with the application

The editors now carry detailed static help: five `.md` files under
`packages/web/src/content/help/`, inlined at build time and rendered in a side
panel (`31-help-rules.png`, `33-help-process.png`). The **Help** button opens
the overview. A link above each editor (*How business rules work*, *How status
machines work*, …) opens the page for the editor in use. The panel sits beside
the editor rather than over it, so the table being explained stays visible.

`help-content.test.ts` holds each page to its editor. Every event, outcome,
action, step type, check and inspector field the editor offers must appear on
its page, so a control added without help fails CI. The test was confirmed to
bite by removing one label from `process.md` and watching it fail.

## Verification

| Check | Result |
|-------|--------|
| `tests/e2e/05b-logic-editors.e2e.spec.ts` (new) | 2 passed |
| `bun run test` | 893 passed, 12 skipped |
| `bun run type-check`, `biome check . --diagnostic-level=error` | clean |
| All five `--check` artifact comparisons, on linux-x64 under CI's bun | up to date |
| Generated app from `examples/drug-discovery.eml.mmd`: install and frontend build | passed |
| `bun install --frozen-lockfile` under CI's bun | no changes |

## Second pass: gstack `/qa`, health 77 → 91

A structured `/qa` run over the same two surfaces, after everything above had
landed: edge cases (empty and invalid inputs, duplicates, deletion), a 390px
viewport, and the generated application's Admin → Business Rules, Automations
and Report Designs. Each fix is its own `fix(qa): ISSUE-NNN` commit with a
regression test. Screenshots are in `screenshots/rules-workflows/qa-pass/`.

### Health Score: 77 → 91

| Category | Baseline | Final |
|----------|---------:|------:|
| Console | 40 | 40 |
| Links | 100 | 100 |
| Visual | 89 | 100 |
| Functional | 44 | 100 |
| UX | 92 | 100 |
| Performance | 100 | 100 |
| Content | 97 | 97 |
| Accessibility | 100 | 100 |

Console stays at 40 because neither source is in scope. One is a CopilotKit
hydration mismatch (third-party `CopilotModal`, also on main). The other is
503s from `/api/v1/shape`, the ElectricSQL sync endpoint, which has no
Electric service in this environment.

### Top 3 fixed

1. **ISSUE-007:** The generated app could not edit any rule its model declares. The Action picker opened blank, and the backend refused every save.
2. **ISSUE-005:** The editor advised adding a catch-all row to `%%action` rules. Under `collect` that row acts on every record.
3. **ISSUE-001:** A rule saved with no entity became a rule on an entity called "event". The model still checked clean, and the rule never fired.

### Summary

| Severity | Found | Fixed | Deferred |
|----------|------:|------:|---------:|
| Critical | 0 | 0 | 0 |
| High | 3 | 3 | 0 |
| Medium | 3 | 3 | 0 |
| Low | 3 | 2 | 1 |
| **Total** | **9** | **8** | **1** |

### Issues

#### ISSUE-001: A rule saved with no entity (high, functional) — verified
With Entity at "Choose…", Save wrote `%%rule rule11 on  event: beforeCreate`.
The checker read that as a rule on the entity `event` (EML251/EML307 warnings
only), so the model still checked clean.

- **Fix (36b2d3b):** `lib/eml/section-problems.ts` holds the rule. The Logic page names the incomplete section and selects it, and `PUT /api/projects/:id/eml` answers 400 for the same reason.
- **Evidence:** [`issue-new-rule-no-entity.png`](screenshots/rules-workflows/qa-pass/issue-new-rule-no-entity.png) (before), [`issue-001-after.png`](screenshots/rules-workflows/qa-pass/issue-001-after.png).
- **Test:** `lib/eml/__tests__/section-problems.test.ts`.

#### ISSUE-002: Fractional priority (low, functional) — verified
The Priority input accepted 2.5, and both runtimes store priority as INTEGER.

- **Fix (230b7e5):** `step=1` on the input, and the value is truncated.
- **Test:** `components/eml/__tests__/rule-priority.test.tsx`.

#### ISSUE-003: Two states with one value (medium, functional) — verified
The saved diagram names states by value, so two "draft" states merged into one
node and the second one's transitions joined the first.

- **Fix (6fbd843):** the editor warns beside its other state-machine notices.
- **Evidence:** [`status-duplicate.png`](screenshots/rules-workflows/qa-pass/status-duplicate.png), [`issue-003-after.png`](screenshots/rules-workflows/qa-pass/issue-003-after.png).
- **Test:** `lib/eml/__tests__/state-flow-duplicates.test.ts`.

#### ISSUE-004: Logic page unusable on a phone (medium, visual) — verified
At 390px the 256px rail stayed beside the editor and left it about 70px.

- **Fix (acf715f):** below md the rail stacks above the editor, capped in height and scrolling. Desktop is unchanged (256 + 1296px).
- **Evidence:** [`mobile-help.png`](screenshots/rules-workflows/qa-pass/mobile-help.png) (before), [`issue-004-after-mobile.png`](screenshots/rules-workflows/qa-pass/issue-004-after-mobile.png).

#### ISSUE-005: `%%action` rules edited as first-match tables (high, functional/UX) — verified
An `%%action` rule is a `collect` table, where every row that fits runs. The
editor treated it as first-match:

- It told the author to add a catch-all row. A blank `prevent` row would refuse every write.
- It warned that the whole-record input "reads no field".
- It offered one "Record" test box that could never match.
- It offered a field picker and "+ input", which the serialiser cannot write back.

- **Fix (02630f1):** wording, coverage, validation and Test with values all follow the hit policy. Test with values evaluates `field op value` checks joined by and/or, offers boxes for the fields they read, and lists every row that fits.
- **Evidence:** [`issue-005-after.png`](screenshots/rules-workflows/qa-pass/issue-005-after.png).
- **Test:** `lib/eml/__tests__/action-table-collect.test.ts`.

#### ISSUE-006: Entity chip overlapping the Operation column (low, visual) — verified
This was in the generated app's rules list, on `bus_admission_application`.

- **Fix (06dfd4c):** `min-w-0` plus `truncate` with a title.
- **Evidence:** [`gen-admin-rules.png`](screenshots/rules-workflows/qa-pass/gen-admin-rules.png) (before), [`issue-006-after.png`](screenshots/rules-workflows/qa-pass/issue-006-after.png).
- **Test:** an assertion in `rule-editor-generated-app.test.ts`.

#### ISSUE-007: Generated app cannot edit the model's own rules (high, functional) — verified
The generated app opened a compiled `%%action` graph with the Action picker
blank, zen-quoted cells and nine columns. `rules.service` then refused any save
with "Column Record does not say which field it reads". This predates this PR.

- **Fix (f6526f1):** shared `rule-content.ts` reads graph outcome cells as plain text and maps `prevent` back to `validation-error`. The shared `RuleTableEditor` is collect-aware, the evaluator moved to shared `bpmn-model.ts`, and the backend accepts a collect table's field-less input.
- **Verified:** an edited rule saved as v2, and `PATCH /api/bus/enrollment/:id {final_grade:null}` answered 400 with the edited message.
- **Evidence:** [`gen-rule-edit.png`](screenshots/rules-workflows/qa-pass/gen-rule-edit.png) (before), [`issue-007-after.png`](screenshots/rules-workflows/qa-pass/issue-007-after.png).
- **Test:** `lib/automation/__tests__/action-graph-editable.test.ts`.

#### ISSUE-008: Automations could not be deleted (medium, UX) — verified
Every "+ New automation" stores a draft, and nothing removed one, so the rail
filled with "Untitled automation".

- **Fix (127291a):** a two-step "Delete this automation" (no `confirm()`), which shows the backend's refusal for model-owned workflows.
- **Evidence:** [`gen-automations.png`](screenshots/rules-workflows/qa-pass/gen-automations.png), [`issue-008-armed.png`](screenshots/rules-workflows/qa-pass/issue-008-armed.png).
- **Test:** an assertion in `rule-editor-generated-app.test.ts`.

#### DEFERRED-1: Section headings travel with the preceding section (low, content)
`extractSections` in `language/composer.ts` keeps a section's trailing prose.
That prose is the next section's `%% ---- …` heading, so Admission Assessment's
read-only flowchart ends with "admission banding". Deleting a rule deletes the
next rule's heading too. The rules themselves are unaffected.

The fix needs a "leading prose" field on `EmlRuleSection`/`EmlWorkflowSection`
that every editor carries through, in a file that feeds five committed bundles.
That is out of scope for a QA pass.

### Verification

| Check | Result |
|-------|--------|
| `bun run test` | 936 passed, 12 skipped |
| `bun run type-check`, `biome check . --diagnostic-level=error` | clean |
| Five `--check` artifact comparisons (CI's bun, linux-x64) | all up to date |
| `scripts/e2e-rules-workflows` with `--generated` | 23 passed (01–06, fresh generated app), after two suite fixes: the runner now gives the app a clean environment, and 06 clicks the designer's real Save control |

### Windows, tabs and fields, not tables and columns

The generated app's rule and report screens named things by storage:
`bus_fee_invoice` in the rules list and as the designer's title, `balance_due`
in the rule editor's field pickers, and print labels guessed from column
names. They now read windows, tabs and fields
(`hooks/use-dictionary-windows.ts`) and show each record type and field under
the label its window uses. The storage keys are still what gets stored and
evaluated. The seeded default print layouts take the form's own fields, in
form order, from `sys_field`.

Evidence: [`view-layer-rules-list.png`](screenshots/rules-workflows/qa-pass/view-layer-rules-list.png),
[`view-layer-reports.png`](screenshots/rules-workflows/qa-pass/view-layer-reports.png),
[`view-layer-designer.png`](screenshots/rules-workflows/qa-pass/view-layer-designer.png).
Spec 06 passes 4/4 against a freshly generated app.

Still showing storage names:
- The seeded validation rules are named `<table>_validation`. The seed also uses that name as its idempotency key.
- AnkaReport draws a bound cell in the designer as `[column_name]`.
