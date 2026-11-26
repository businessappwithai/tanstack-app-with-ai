# Business rule and workflow editor E2E

End-to-end Playwright tests for the **business rule editor** and the **workflow
editors** (Lifecycle, Status, Process), and nothing else. They drive the
editors in Chromium the way an author does, then check what was saved against
what the generator and the generated runtime read.

```bash
bun run test:e2e:rules-workflows                 # the modelling tool (01–05)
bun run test:e2e:rules-workflows -- --generated  # also generate, boot and test the app (06)
bun scripts/e2e-rules-workflows/run.ts --model path/to/other.eml.mmd --generated
bun scripts/e2e-rules-workflows/run.ts -- --grep "Report Designs"   # after `--`: Playwright flags
bun scripts/e2e-rules-workflows/run.ts -- specs/14-crud-rules-and-workflows.spec.ts   # CRUD of 52 rules + 50 workflows
```

`--generated` needs `DATABASE_URL`. It creates `<db>_rules_workflows_e2e`
beside it, generates the model with the real pipeline, migrates and seeds, and
starts the generated backend (4701) and front end (4700). The app runs without
the modelling tool's `VITE_*`, `DATABASE_URL`, `PORT` and auth variables, even
from a shell that has sourced the tool's `.env`: Vite prefers a process variable
to the app's own `.env`, and an inherited `VITE_API_URL` once sent every
dictionary call to the tool. `--no-server` uses a
modelling tool that is already running. `PLAYWRIGHT_CHROMIUM_PATH` points at a
Chromium on the machine when Playwright cannot download its own.

## What each spec holds

Every spec drives the page and nothing else: no API call builds, saves or reads
a rule or a workflow, so what passes is what an author can do.

| Spec | What it proves |
|---|---|
| `01-business-rules-editor` | **41 rules** from `scenarios/rule-catalogue.ts`, each built in the decision table with its own controls. Between them: every operator of the palette — Text (equals, not equals, is one of, is not one of, starts with, ends with, contains, is empty, is not empty, any, custom), Number (equals, not equals, >, ≥, <, ≤, between, is one of, is not one of, empty, not empty, custom), Boolean (equals, empty, not empty, custom) and Date (after, before, same day, same or after, same or before); every answer (`validation-error`, `transform`, `allow`); one to three input columns; one to three rows; priorities from 1 to 999. Each rule is tried with sample records in **Try it**, saved, the page reloaded, and the rule opened again and tried again |
| `02-workflow-editors` | **50 workflows** from `scenarios/workflow-catalogue.ts`: 16 lifecycle workflows (all 13 hooks, field-scoped hooks, up to four hooks), 12 status machines (2–6 states, branching, loops back, several end states, labelled and unlabelled moves) and 22 processes (every step type; every test — is, is not, >, ≥, <, ≤, contains, starts with, is empty, is not empty, changed; a repeat; started by a rule and by a created, updated, deleted or any write). Each is saved, the page reloaded, and the workflow reopened from the rail |
| `03-graph-rules` | **11 rules** (`scenarios/graph-rule-catalogue.ts`) drawn node by node — Expression, Function and Switch nodes, singly and chained — configured, tried, saved and reopened |
| `04-editor-features` | The controls around building: hit policy (First and Collect), the Developer and Business views, adding, removing and dragging table rows, the Simulator, refusing a rule with no entity, deleting a rule or a workflow, attaching a rule to a hook, removing a hook, the Help panel |
| `14-crud-rules-and-workflows` | **Full create, read, update and delete for 102 items** on the education model: the 41 decision tables and 11 graph rules (52 rules) and the 50 workflows above. Each item is built and saved (create, and the server holds it once); reloaded and opened from the rail (read: entity, priority, nodes, Try it, or hooks, steps, states and moves); renamed and changed — a rule's message, priority or function body, a lifecycle's extra hook, a status machine's extra state and move, a process's extra step — saved and read back (update: the server holds the new name and nothing under the old one); and deleted from the rail (delete: gone from the page and the stored model, no section left under its title). `CRUD_KIND=rules\|workflows`, `CRUD_ONLY=<substring>` |
| `07-rule-kinds-and-try-it` | The Enhance page's rule editor has no "Runs when", and the dry-run route behind Try it: refuses nobody and a stranger, runs a real graph, refuses a function that reaches for the network |
| `09-rule-graph-builder` | A rule built from nothing in the graph editor, run in the Simulator and in Try it, saved and read back; Monaco comes from the application, not a CDN |
| `08`, `10` | The generated application: its rules are enforced, its builders work (need `--generated` or a running generated app) |
| `11` | Thirty business rules in one Opportunity flow — Expression, two Decision tables, Function, Switch — built node by node and cell by cell in a running generated CRM, then run in the Simulator and with fifteen Try it samples, one per path; saved and reopened. `E2E_NO_SERVER=1 E2E_BASE_URL=…` against the running app |
| `14-qa-process-every-step` | One project, built step by step: nine FeeInvoice rules (decision tables answering block, transform and allow; graph rules of Expression, Function, Switch and a chain), a lifecycle on all six rule-carrying hooks with a rule attached to each, a **59-step process** — every step type seven times, added one at a time and read back after each — and a rule-started process. `QA_STATE=<file>` resumes in the same project; `QA_MODEL_OUT=<file>` writes the stored model for 15 |
| `15-qa-generated-run` | Needs `--generated --model <the model 14 wrote>`. One update runs the 59-step process to success in the generated app — all seven web calls reach a local echo server, every line it creates it updates and deletes — and the rules attached to the hooks refuse the writes they should |
| `12-generated-state-machine` | Needs `--generated --model scripts/e2e-rules-workflows/models/rule-kinds.eml.mmd`. The generated helpdesk enforces `TicketLifecycle`: `/api/workflows/transitions` offers exactly the drawn moves, a drawn move is accepted, an undrawn one (`open` → `resolved`) is refused and leaves the record alone, and a closed ticket goes nowhere |

```bash
RULES_ONLY="Year group" bun run test:e2e:rules-workflows     # rules whose name contains it
WF_ONLY="Check Equals"  bun run test:e2e:rules-workflows     # workflows likewise
GRAPH_ONLY="function blocks" …                               # graph rules likewise
CRUD_KIND=workflows CRUD_ONLY="Hooks" …                      # spec 14: one half, a subset
E2E_ACTION_TIMEOUT=10000 …                                   # fail a stuck click sooner (ms)
```

A full run of 01 takes about half an hour, 02 a quarter of one, 03 ten minutes,
14 about an hour and a half (rules about an hour, workflows about twenty minutes);
run them one at a time — together they starve the dev server and saves time out.

## Testing a new rule or workflow

Add an object to `scenarios/rule-catalogue.ts` or `scenarios/workflow-catalogue.ts`;
no other code changes are needed. A rule names its entity, input fields, rows
(`"Number:greater than:60"` — the palette's own words), the answers each row
gives and the sample records Try it must answer. A workflow names its kind and
its hooks, states and moves, or steps; a step uses the words its inspector shows.

Controls are found by the words on the screen, never by position, so a field
added to an inspector does not break every step after it.

## Against a generated application

The Logic step and a generated app's **Admin → Rules and workflows** screen are one component
(`@appwithai/editors`' `LogicWorkbench`), so the same specs drive both. Set `LOGIC_TARGET=generated`
and point the base URL at the app:

```bash
LOGIC_TARGET=generated E2E_BASE_URL=http://localhost:4700 \
  bun scripts/e2e-rules-workflows/run.ts --generated --no-server --model <model.eml.mmd> -- specs/02-workflow-editors.spec.ts
```

`authorWithProject`/`browserAs` sign in as the app's administrator instead of creating a
project, and `logicPath` supplies the screen's URL. Specs 01–04 are meant for this; 03/04
read the stored model through the modelling tool's API and run there only where they do.
