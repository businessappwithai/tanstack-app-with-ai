# QA Report: AppWithAI — Education Management System, end to end

| Field | Value |
|-------|-------|
| **Date** | 2026-09-09 / 2026-09-10 |
| **URL** | `https://appwithai.org/try-it-yourself.html` → `guide/run-in-browser.html` → the deployable `.zip` under `docker compose` → `./start.sh`'s `/app` and `/report` |
| **Branch** | `claude/gstack-qa-ems-skill-de3uui` (this repository, `businessappwithai.github.io` and `app-and-report-with-ai-tanstack`) |
| **Tier** | Standard (critical + high + medium) |
| **Scope** | The whole path a reader takes: the conversion page, the `llmdetailed.txt` §10 authoring protocol, the browser application, the model viewers, the deployable stack, and the reporting platform the orchestrator brings up beside it |
| **Pages visited** | 10 (try-it-yourself, run-in-browser, viewers, the browser application, the deployed application's login and dashboard, and the platform's reports, charts and dashboard) |
| **Screenshots** | 20 (4 kept beside this report, under `screenshots/`) |
| **Framework** | Static site (no build step) · WebAssembly browser runtime (PGlite) · NestJS + TanStack Start + PostgreSQL + Electric under Docker · TanStack Start + Kysely reporting platform behind nginx |

The run has two phases. **Phase 1** is the reader's path — the conversion page
through to the deployable zip — and is what ISSUE-001 to ISSUE-004 came out of.
**Phase 2** is the same model taken through `./start.sh` in
`app-and-report-with-ai-tanstack`, which generates the application, derives a
reporting pack from the model and loads one into the other; ISSUE-005 to
ISSUE-008 are its.

## Method, and one accommodation to state plainly

Driven with **Chromium through Playwright**, not with gstack's own `$B` binary: this
session could not run gstack's installer, and the Aside browser is macOS-only.
Same evidence, same report, different driver.

**The browser work ran against a local mirror of the site, not the live host.**
This sandbox's egress intercepts TLS, and Chromium would not complete a
handshake to `appwithai.org` (the proxy log shows the tunnel closing mid-exchange);
`curl` reached it fine. So every file the run touches was fetched from the live
site and compared first — `try-it-yourself.html`, `llmdetailed.txt`,
`guide/run-in-browser.html`, `assets/js/appwithai-wasm.js`,
`assets/js/run-in-browser.js`, `assets/js/appwithai-fullstack.js` and
`assets/vendor/stack-templates.json` are **byte-identical** between the live host
and the checkout that was served locally. The findings below are therefore
findings about what appwithai.org is serving today, and the two that are
site-side were verified against the live bytes before anything was changed.

## Health Score

### Phase 1 — the reader's path: 73 → 97

Weighted over the categories actually exercised (Console 15, Links 10,
Functional 20, Visual 10 — 55 points of weight). Accessibility, Performance and
Content were **not tested**, and are excluded rather than scored.

| Category | Before | After | Why |
|----------|-------:|------:|-----|
| Console | 70 | 100 | 2 reproducible errors (the dictionary sync failure, the 500 behind it); both gone |
| Links | 100 | 100 | 25 same-origin links on the conversion page, all 200 |
| Functional | 47 | 92 | 3 high + 1 medium; the three highs fixed and verified, the medium deferred with a reason |
| Visual | 100 | 100 | provisional — 1440px and 390px only, no horizontal overflow at either |

`(70×0.15 + 100×0.10 + 47×0.20 + 100×0.10) / 0.55 = 72.5 → 73`
`(100×0.15 + 100×0.10 + 92×0.20 + 100×0.10) / 0.55 = 97.1 → 97`

### Phase 2 — the orchestrator and the reporting platform: 53 → 98

Console 15, Functional 20, Visual 10 (45 points of weight). Links were not
re-tested in this phase.

| Category | Before | After | Why |
|----------|-------:|------:|-----|
| Console | 60 | 100 | five `500`s across the report and chart data endpoints, on every tile; none after |
| Functional | 25 | 95 | the generated application implemented almost none of what the model declares (ISSUE-005), so the dashboard it fed was empty; 3 fixed and verified, ISSUE-004 still deferred |
| Visual | 100 | 100 | no layout defect at 1440px |

`(60×0.15 + 25×0.20 + 100×0.10) / 0.45 = 53.3 → 53`
`(100×0.15 + 95×0.20 + 100×0.10) / 0.45 = 97.8 → 98`

## Top 3 Things to Fix

1. **ISSUE-005: `./start.sh` generated an application that implemented almost none of its model** — no state machines, no roles, no authored rules, no lifecycle handlers, no dropdown values, no lookups, one category. It generated, built and ran, which is why nothing caught it. Fixed.
2. **ISSUE-001: every `validation-error` rule was inert in the browser application** — the rule matched, the record was written anyway, and the caller was told nothing. Fixed.
3. **ISSUE-003: the generated Electric proxy produced a malformed HTTP response** — `transfer-encoding: chunked` relayed over a fixed-length body, so every dictionary shape request answered 500. Fixed.

## Console Health

| Error | Where | Count | Status |
|-------|-------|------:|--------|
| `An error occurred while syncing collection: dictionary:<table> … TypeError: Failed to construct 'URL': Invalid URL` | deployed stack, every page load | 6 (one per dictionary collection) | fixed — ISSUE-002 |
| `Failed to load resource: the server responded with a status of 500` (`/api/v1/shape`) | deployed stack, every page load | 6 | fixed — ISSUE-003 |
| `net::ERR_CONNECTION_RESET` for `fonts.googleapis.com` and `us.i.posthog.com` | every page | — | **environment, not a defect**: this sandbox blocks both hosts |
| `401 GET /api/auth/me` before sign-in | browser application | 1 | **not a defect**: the pre-session probe the sign-in screen makes |
| `500 GET /report/api/reports/<id>/data` and `/report/api/charts/<id>/data` | the reporting platform, every report and chart built on a `oneToMany` | 5 distinct endpoints | fixed — ISSUE-007 |

## Summary

| Severity | Count |
|----------|------:|
| Critical | 1 |
| High | 4 |
| Medium | 3 |
| Low | 0 |
| Informational | 4 |
| **Total** | **12** |

---

## Issues

### ISSUE-001: every `validation-error` rule was inert in the browser application

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **Where** | `guide/run-in-browser.html` — the WebAssembly application, for every model |
| **Fix** | `packages/generator/templates/wasm/server/lib/rules.js` |

**Description.** The rules compiler translates EML's `validation-error` into the
runtime's own vocabulary, `prevent`, because that is what the NestJS stack
refuses a write on (`rules.service.ts` checks `ruleAction.type === 'prevent'`).
The browser runtime classified a matched row by the same cell and recognised only
`reject` and `error`, so a `prevent` row fell through the chain into
`notifications` — and `bus.routes.js` refuses a write on `violations` alone. The
rule matched, the write was stored, and the caller got a 200.

It fails in the way that is hardest to notice: the rule is seeded into
`sys_rule_definitions`, listed in the application's own **Business Rules**
screen, and drawn by the viewers. It simply refuses nothing.

**Repro (before the fix), against the Education Management System model:**

| Request | Expected | Actual |
|---|---|---|
| `PUT /api/bus/student/<id>` with `status: withdrawn`, `withdrawal_reason: null` | refused — `requireWithdrawalReason` | **200**, record written |
| `POST /api/bus/attendancerecord` with `status: late`, `minutes_late: null` | refused — `requireMinutesLate` | **201**, record written |
| `POST /api/bus/payment` with `amount: 999999`, `balance_before: 10` | refused — `refuseOverpayment` | **201**, record written |

The `transform` and `trigger-workflow` halves of the same table worked
throughout — an application created with `prior_attainment_score: 82` came back
banded `priority`, and one with no score came back `review` — which is what
narrowed this to the refusal branch rather than to the engine.

**After the fix, same three requests, same model, same page:**

| Request | Result |
|---|---|
| `withdrawn` with no reason | **422** — *"A business rule refused this change"*, violation `studentRecordControl / prevent / A withdrawal needs a reason — the retention report is built from it."* |
| `withdrawn` with a reason | **200** |
| `late` with no minutes | **422** |
| `late` with `minutes_late: 7` | **201** |
| payment over the balance | **422** |
| payment within the balance | **201** |

**Regression test.** `packages/generator/src/rules/__tests__/browser-runtime-honours-prevent.test.ts`
compiles a directive with the real compiler and evaluates it with the real
browser engine, so the two runtimes are held to the same meaning rather than to
each other's spelling. Reverting the one-line fix fails it.

---

### ISSUE-002: the deployable zip shipped a bug the generator had already fixed

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **Where** | `assets/vendor/stack-templates.json` on the live site |
| **Fix** | rebuilt with `bun run build:stack-templates` and re-vendored |

**Description.** The zip's 466 files come from `stack-templates.json`, not from
`appwithai-fullstack.js`. The site's copy was **three files behind** this
repository — exactly commit `6140922`, *"Fix Electric sync, the Tailwind glob and
the password placeholder in generated apps"*:

```
tanstack-start-nestjs/frontend/src/lib/sys-collections.ts
tanstack-start-nestjs/frontend/src/routes/auth/login.tsx
tanstack-start-nestjs/frontend/tailwind.config.js
```

So every deployable zip downloaded from appwithai.org — and every chapter-10
WebContainer run, which mounts the same file map — carried a `SHAPE_URL` that is
a *relative* path. The Electric client hands it to `new URL(...)` with no base,
which throws, and the console filled with
`TypeError: Failed to construct 'URL': Invalid URL`, once per dictionary
collection, before a single shape request left the browser. Observed in the
`docker compose` run of the first zip.

**Fix and verification.** `build:stack-templates` rebuilt the file (353
templates, 3 changed) and it was copied to the site repository. The zip
downloaded after that carries `SHAPE_PATH` — the fixed shape — and the
`Invalid URL` error is gone from the console of a fresh `docker compose up
--build`.

**Note for whoever re-vendors next.** The site's `CLAUDE.md` says the five
generator artifacts move together. Four of them (`checker.js`, `fixer.js`,
`appwithai-wasm.js`, `appwithai-fullstack.js`) were byte-identical to this
repository's builds; `stack-templates.json` was not, and it is the one that is
**gitignored upstream**, so nothing compares it. That is why it drifted.

---

### ISSUE-003: the generated Electric proxy produced a malformed HTTP response

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **Where** | the deployed stack — `GET /api/v1/shape`, every dictionary collection |
| **Fix** | `packages/generator/templates/tanstack-start-nestjs/backend/src/modules/electric/electric.controller.ts.hbs` |

**Description.** With ISSUE-002 fixed, the shape requests finally left the
browser — and every one of them answered **500**. The backend's own log recorded
the same requests as **200**, which is the shape of a relay fault rather than an
upstream one.

The proxy copies every upstream header and then sends the body it read with
`fetch`. Electric answers `transfer-encoding: chunked`; `fetch` consumes the
chunking and hands back a decoded buffer. The relayed response therefore
announced chunked framing and carried a fixed-length body — a response nothing
downstream can read. Reproduced outside the browser: a plain `fetch` from Node
to the backend's shape endpoint fails with `UND_ERR_HTTP_PARSER` while the body
visibly contains Electric's rows. The generated front end's own `/api` proxy
turns the same refusal into the browser's 500, with the upstream's `electric-*`
headers still attached, so the failure reads like an Electric problem.

**Fix.** The relay now drops `transfer-encoding`, `content-encoding`,
`content-length`, `connection` and `keep-alive`, and keeps everything else —
including the `private, no-store` cache header the proxy sets deliberately,
because a shape response is computed for one role.

**Regression test.**
`packages/generator/src/templates/__tests__/electric-proxy-framing.test.ts`.

---

### ISSUE-004: child entities appear on the deployed dashboard as a "General" group

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | ux |
| **Where** | the deployed stack's dashboard |
| **Status** | **deferred** — see below |

**Description.** `%%entity <Child> parent: <Parent>` says a child has no life
away from its parent, and §3.3.1 is explicit that a category lists what appears
on the dashboard and a child does not. The browser runtime implements exactly
that (`ui/main.js`: `state.entities.filter((entity) => !entity.parentEntity)`)
and its dashboard shows 15 cards for this model's 19 entities.

The deployed NestJS dashboard shows all 19: `AssessmentResult`,
`AttendanceRecord`, `FeeInvoiceLine` and `StudentGuardian` are bucketed into a
**GENERAL (4) — "Entities not assigned to a specific category"** group, which is
a screen listing every invoice line ever written.

**Why it is deferred rather than fixed.** The two stacks disagree because the
NestJS side has no idea which entities are children: `resolveCategories()` is
handed only entity *names*, and the generated dictionary has nowhere to record a
parent — `sys_tab.parent_column_id` exists in the migration and nothing fills it.
Filtering at the one endpoint that renders the dashboard would leave the same
entities in the seed's fallback sweep (`WHERE sys_category_id IS NULL AND
table_name LIKE 'bus_%'`), so a correct fix carries the parent into the
dictionary and reads it in both places. That is a change to the generated
dictionary rather than a QA repair, and it is not something this run could
validate to the standard of the three above.

---

### ISSUE-005: `./start.sh` generated an application that implemented almost none of its model

**Severity**: Critical · **Repository**: `app-and-report-with-ai-tanstack` · **Status**: fixed and verified

The symptom was in the reporting platform: every one of the dashboard's ten
tiles read *No data to display*. The cause was two layers down.

```
$ docker exec …-postgres-1 psql -U app -d education_management_system \
    -tAc "select status, count(*) from bus_student group by 1"
Active|1
In Progress|1
Completed|1
Pending|1
```

The model declares `%%enum StudentStatus: enrolled, on_leave, suspended,
graduated, withdrawn`. None of those four words is one of them, so every query
the pack derived from the enum matched nothing. The same four appeared in
`bus_enrollment`, `bus_fee_invoice`, `bus_class_section` and
`bus_discipline_incident`.

`common/language/cli/src/generate/tanstack.ts` assembled the generator's inputs
a second time — mapping `EmlModel` onto core `Entity[]`/`Relationship[]` by hand
and driving `GeneratorOrchestrator`, whose constructor takes entities and
relationships and nothing else. Everything the model declares beyond its columns
never reached the generator. Read off the generated tree:

| Seed | What it held |
|---|---|
| `05b_workflow_transitions.ts` | `// No state-machine workflows in this model` — the model declares **five** |
| `04b_operation_access.ts` | `RBAC_ROLES = []`, no operation access, no transition access — the model declares 8 roles and 108 rules |
| `04_business_rules.ts` | `AUTHORED_RULES = []` |
| `01_sys_references.ts` | the 17 standard references only; no model enum, no `sys_ref_list` value |
| `02b_entity_categories.ts` | one `General` group |
| `src/modules/hooks/handlers/` | absent |

And in the hand mapping itself: `isForeignKey` (so every reference column a raw
uuid rather than a lookup, and typed `varchar` rather than `uuid` in the
migration), `description` (`%%field help:`), `semanticType`, `%%index` and
`%%entity … parent:`.

None of it failed. 378 files were written, the images built, the containers went
healthy and `/app` answered. The entity-access guard enforced no topology at
all, for any caller, because there were no edges to enforce.

**Fix.** Drive `packages/generator/src/pipeline/generate-application.ts` — the
path the shipped CLI and `/api/generate` both take — with the model *source*, so
there is one reading of a model instead of two that can disagree.

**After**, from an empty volume:

```
sys_workflow_transitions                     61 rows
sys_ref_list where sys_reference_id >= 1000  121 rows
bus_student.status      enrolled | graduated | on_leave | suspended
bus_enrollment.status   completed | enrolled | pending | withdrawn
```

**The check that would have caught it.** `check:stacks` asserted a file count —
exactly the measurement that passed while the application was hollow. It now
asserts, for the heavy target, that every construct the *model* declares is
present in the generated file that carries it. Verified to fail on the previous
code with four findings and to pass on the fix.

---

### ISSUE-006: the model's own help text never reached the application

**Severity**: Medium · **Repository**: this one · **Status**: fixed and verified

`CLAUDE.md` states where a column's `%%field … help:` lands: "It becomes
`sys_column.description`, which the generated form renders under the control and
the Application Dictionary shows beside the column."

Neither half was true. The dictionary seed never wrote `sys_column.description`
at all, and the help it did write — `sys_field.help`, which is what the form
renders — was composed entirely from the column's shape. The model says:

> The school's own identifier, unique and unchanging for the child's whole time
> here. Printed on every report, invoice and examination entry.

The application said:

> The Student Number of this Student. Required — the record cannot be saved
> while this is empty.

Invisible from the generator, because the manual renders from the parsed model
directly and reads exactly as written, while the application shipping beside it
carried none of the same prose. 323 columns of authored help, discarded.

**Fix.** The author's words open the window, the tab and the field; the derived
sentences follow, because "required" and "must be unique" are facts the author's
sentence does not carry and a model with no help text must still get them.

**After**, in the running application's database:

```
sys_column where description is not null          159
sys_column.description  for bus_student.student_number
  → The school's own identifier, unique and unchanging …
sys_field.help          for the same column
  → The school's own identifier … Required — the record cannot be saved while
    this is empty. Must be unique: …
```

---

### ISSUE-007: 26 derived report queries could not run against the schema the generator emits

**Severity**: High · **Repository**: `app-and-report-with-ai-tanstack` · **Status**: fixed and verified

With ISSUE-005 fixed, four dashboard tiles changed from empty to
*No chart data available*, and the platform's log said why:

```
Error fetching chart data: error: operator does not exist: text = uuid
```

`reporting-pack.ts` emitted `c.<fk> = p.<pk>::text` for every `oneToMany` the
diagram draws. That cast was right only while ISSUE-005 left every foreign key
a `varchar`; with a declared foreign key now `uuid` on both sides, PostgreSQL
has no implicit cast and the query does not run at all.

The pack cannot see the schema, but it can read the same rule the dictionary
does: a column becomes a Table Direct reference — and so `uuid` — when the model
marks it `FK` *and* names it `_id` or `_by`. The cast is emitted where the model
says it is needed, and the parent's primary-key index is used where it is not.
The model's own 34 `%%report` casts were of the same kind and went with it.

**Verified** by planning all 151 pack queries — the 40 authored and 111 derived —
against the schema `./start.sh` actually generated: **26 failing before, 0
after**. The dashboard's ten tiles then render, including six lifecycle charts
over the states each diagram declares, in the diagram's order, zeroes included:
`screenshots/report-dashboard-after.jpg`.

---

### ISSUE-008: nginx dropped the published port from every redirect

**Severity**: Medium · **Repository**: `app-and-report-with-ai-tanstack` · **Status**: fixed

`common/docker/nginx/default.conf` sends `/`, `/app` and `/report` on with
`return` directives written as paths, and nginx builds an absolute redirect from
`$host` and the port it is *listening* on — 80, inside the container. Published
anywhere else, which is exactly what `./start.sh --port 8080` does, `/report`
answered `Location: http://localhost/report/`: the port silently dropped, and
the reader lands on nothing. `absolute_redirect off` keeps them relative.

---

## Informational — checked, not defects

| # | Observation |
|---|---|
| INFO-1 | **A handler name serves one event per entity.** `%%hook afterCreate recalculateInvoiceTotal` and `%%hook afterUpdate recalculateInvoiceTotal` on the same entity: the compiler keeps the first and says so, because a handler name is a function name in the generated per-entity module. It is intended, and `compile-hooks.spec.ts` asserts it. The model was corrected to name one handler per event (`addLineToInvoiceTotal`, `recalculateInvoiceTotal`, `removeLineFromInvoiceTotal`), after which the generator reported nothing skipped. |
| INFO-2 | **The browser application does not enforce state-machine topology.** `graduated → enrolled`, an edge this model never draws, was accepted with a 200 there; the deployed stack refuses the same write with `403 Invalid transition: 'bus_student' has no edge from 'withdrawn' to 'enrolled'`. This is documented (`llms-full.txt` §5.2 names the stack deliberately), and the browser runtime records the crossing as `status: unmodelled` in `sys_workflow_runs` rather than refusing it. Worth knowing before demonstrating a lifecycle in a browser tab. |
| INFO-3 | **Seeded sample rows do not satisfy the model's own rules.** The browser application's 190 rows include students with `status: enrolled` carrying a `withdrawn_on`, and `year_group` values like 93 for a school that teaches years 7–13. Seeds honour `%%enum` (documented) but not `%%action` rules and not numeric ranges, which EML has no syntax for. Not a defect; it does mean a demonstration should create its own record rather than point at row four. |
| INFO-4 | **`try-it-yourself.html` reveals its cards with an IntersectionObserver.** A full-page screenshot shows six of the nine cards blank, which reads like a bug and is not one: scrolling to each card reveals all nine (verified). The content is nonetheless invisible without JavaScript and in print, and there is no `prefers-reduced-motion` path. Left alone — it is site-wide, pre-existing, and outside what this run was asked to change. |

## What was verified and found working

- **The conversion page.** 25 same-origin links, all 200. No console error that is not this sandbox blocking Google Fonts or PostHog. No horizontal overflow at 1440px or at 390px.
- **The authoring protocol.** `llmdetailed.txt` §10 run end to end for an Education Management System: 19 entities, 178 columns, 31 relationships, 25 enums, 11 state machines, 10 rule sections, 5 sagas, 19 hooks, 8 roles, 68 `%%rbac` directives, 40 `%%report` directives. **0 errors, 0 warnings** from `language/checker.ts`, from the published `guide/check-model.mjs`, and from the viewers' own copy; **20/20** from the site's `scripts/check-model.mjs` scorer.
- **The browser application.** Generated (43 files, 190 sample rows) and booted on PGlite in ~160s. Sign-in as the administrator, 15 dashboard cards in 7 categories, the dictionary, the manual, entity lists with real display values, record detail, create and read back, audit and workflow endpoints all 200.
- **The role matrix, three ways.** The generated sign-in screen, the viewers' Access tab and the model itself agree: principal 19 of 19, registrar 17, head of department 12, teacher 12, finance officer 11, guardian 11, counsellor 10, admissions officer 8. No role signs in to an empty application.
- **The reporting platform.** `./start.sh` from an empty volume: the seeder exits 0 having cached 54 tables and loaded **151 saved queries, 132 reports, 91 charts and a 10-widget dashboard**. Signed in as `admin@admin.com`, three reports return rows with the model's own column labels, a chart draws with 4 series points, and the dashboard renders all ten tiles — **zero HTTP errors, zero console errors**. The six lifecycle charts show the states each `stateDiagram-v2` declares, in the diagram's order, with the unreached ones at zero rather than missing.
- **The deployable zip.** 466 files, 1.4MB. `docker compose up --build` brings up PostgreSQL (pgvector), Electric, the NestJS API and the TanStack Start front end; migrations and seeds run on a fresh volume; the backend goes healthy; sign-in works; business rules refuse (`400 Business rule validation failed`) and allow correctly; and the state machine refuses an undrawn edge with a 403 that names the edge.

## Fixes Applied

| Issue | Fix status | Files |
|-------|-----------|-------|
| ISSUE-001 | **verified** — before/after through the real application | `packages/generator/templates/wasm/server/lib/rules.js`, `packages/generator/src/generators/wasm/runtime-assets.generated.ts`, `html/assets/appwithai-wasm.js`, site `assets/js/appwithai-wasm.js` |
| ISSUE-002 | **verified** — the new zip carries the fixed file and the console error is gone | site `assets/vendor/stack-templates.json` |
| ISSUE-003 | **verified** — shape requests answer 200 and the dictionary syncs | `packages/generator/templates/tanstack-start-nestjs/backend/src/modules/electric/electric.controller.ts.hbs`, site `assets/vendor/stack-templates.json` |
| ISSUE-004 | **deferred** — reason above | — |
| ISSUE-005 | **verified** — regenerated from an empty volume; transitions, roles, rules, handlers, enums and categories all present | `app-and-report-with-ai-tanstack`: `common/language/cli/src/generate/tanstack.ts`, `common/scripts/check-stacks.ts` |
| ISSUE-006 | **verified** — read back out of the running application's `sys_column` and `sys_field` | `packages/generator/templates/common/seeds/sys-dictionary.ts.hbs`, site `assets/vendor/stack-templates.json` |
| ISSUE-007 | **verified** — 151 of 151 pack queries plan against the real schema | `app-and-report-with-ai-tanstack`: `common/build/reporting-pack.ts`, `common/examples/education-management-system.eml.mmd` |
| ISSUE-008 | **fixed** | `app-and-report-with-ai-tanstack`: `common/docker/nginx/default.conf` |

**How the rebuilt bundle was produced.** `html/assets/appwithai-wasm.js` is a
`Bun.build` output, and this repository's `--check` refuses a rebuild on a
different runtime because the bytes would be wrong for CI. It was therefore
rebuilt in the `oven/bun` image of the version `.github/workflows/ci.yml` pins — on
`linux-x64`, and all five `--check` comparisons pass afterwards.

## Regression Tests

| Issue | Test file | Status |
|-------|-----------|--------|
| ISSUE-001 | `packages/generator/src/rules/__tests__/browser-runtime-honours-prevent.test.ts` | committed — 4 cases; fails on the pre-fix runtime |
| ISSUE-003 | `packages/generator/src/templates/__tests__/electric-proxy-framing.test.ts` | committed — 3 cases |
| ISSUE-004 | — | deferred with the issue |
| ISSUE-005 | `app-and-report-with-ai-tanstack`: `common/scripts/check-stacks.ts` — the behaviour-surface assertion, run by `root-ci.yml` | committed; fails on the pre-fix code with 4 findings |
| ISSUE-006 | `packages/generator/src/templates/__tests__/dictionary-help-text.test.ts` | committed — 5 cases, 4 of which fail on the pre-fix template |
| ISSUE-007 | `app-and-report-with-ai-tanstack`: `common/scripts/check-reporting-pack.ts` — already existed, and is what catches this class | the check now runs against a schema with real foreign keys |

## Ship Readiness

| Metric | Value |
|--------|-------|
| Health score | phase 1: 73 → 97 · phase 2: 53 → 98 |
| Issues found | 12 (1 critical, 4 high, 3 medium, 4 informational) |
| Fixes applied | 7 (6 verified end to end, 1 — ISSUE-008 — verified by reading the response) |
| Deferred | 1, with the reason written down |

**Three repositories move together here.** The generator fixes are only in front
of a reader once the site re-vendors; the site's re-vendored
`stack-templates.json` is only correct because the template fixes landed first;
and the orchestrator's pack fix is only correct because the generation fix
landed first — a pack that casts a foreign key to text is right against a
hollow application and wrong against a real one.

| Repository | Branch / PR |
|---|---|
| `app-with-ai-tanstack` | `claude/gstack-qa-ems-skill-de3uui` — PR #125 |
| `businessappwithai.github.io` | `claude/gstack-qa-ems-skill-de3uui` — PR #70 |
| `app-and-report-with-ai-tanstack` | `claude/gstack-qa-ems-skill-de3uui` — PR #16 |
