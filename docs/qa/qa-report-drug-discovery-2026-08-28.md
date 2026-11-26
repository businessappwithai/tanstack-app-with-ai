# QA Report — drug-discovery (CLI generator + generated application)

**Date:** 2026-08-28
**Target:** the `appwithai` CLI, `packages/generator/src` and `packages/generator/templates`
**Source model:** `examples/drug-discovery.eml.mmd` — 19 entities, 31 relationships, 7 categories
**Branch:** `claude/drug-discovery-cli-e2e-tests-ebt36y`
**Stack:** TanStack Start + React 19 (frontend), NestJS + Fastify + Kysely (backend), PostgreSQL 16

Every fix lands in the generator, so every generated application picks it up —
not just this output. Follow-up to `qa-report-drug-discovery-2026-08-13.md`;
none of that pass's issues had regressed.

---

## Summary

| Severity | Found | Fixed | Deferred |
|----------|------:|------:|---------:|
| Critical | 2      | 2      | 0        |
| High     | 5      | 5      | 0        |
| Medium   | 6      | 6      | 0        |
| Low      | 1      | 1      | 0        |
| **Total**| **14** | **14** | **0**    |

### Top 3

1. **The state machine was decorative.** Topology enforcement lived inside a
   loop over `%%guard` role rules, so an edge the model never drew was refused
   only where a role restriction happened to cover it — and never for an
   administrator at all. A Program moved from `proposed` straight to `on_hold`
   and nothing objected (ISSUE-003, critical).
2. **Two migrations existed but were never run**, so two seeds failed on every
   generation — and the seed runner reported success and exited 0 regardless,
   which is why CI had stayed green (ISSUE-001, ISSUE-002, critical/high).
3. **The generated frontend could not produce its route tree**, so a fresh
   application did not typecheck at all — around seventy errors, all the same
   missing module (ISSUE-005, high).

ISSUE-012 to ISSUE-014 came out of a later pass that ran the suite repeatedly
rather than once. Two of them are about how the suite is *run* rather than what
it asserts, and both produced failures that pointed somewhere other than their
cause: a runner that killed a launcher and left the server behind (ISSUE-012),
and a CI job running an ordered, stateful suite in one parallel process
(ISSUE-013).

---

## Method

1. Generated a fresh application with the CLI:
   `node packages/generator/dist/cli/generate.js generate -i examples/drug-discovery.eml.mmd -o generated-projects/drug-discovery -n drug-discovery`
2. Ran the generator's own migrate + seed pipeline against a local Postgres 16.
3. Extended the generated `tests/` suite from 47 suites to 51, adding coverage
   for the Application Dictionary's presentation layer, its references, the
   state machines, and performance budgets (see **New coverage** below).
4. Ran the full suite repeatedly — against a fresh database, against an already
   populated one, and back to back — at 300 to 500 records per entity.
5. Fixed each failure in the generator, regenerated from scratch, and re-ran.
6. Verified the end state with a clean `--run-tests` run of the CLI, plus
   `bun run type-check`, `bun run lint`, `bun run test` and `bun run test:wasm:cli`
   in this repository, and `tsc --noEmit` in both halves of the generated app.

---

## New coverage

Four suites, generated for every application, not written into this one output.

| Suite | What it holds the application to |
|-------|----------------------------------|
| `02b-dictionary-layout` | Every entity has a window; every window has a tab bound to that entity's own table; every modelled column has a field; sequence numbers are distinct; labels are humanised; the grid is drawn from fields the form knows; `window-help` answers. |
| `02c-dictionary-references` | Every column's reference resolves; every foreign key names a table that exists and a label column that table actually has; every dropdown is fed, and offers only values the model declares; the model's required fields are mandatory. |
| `06b-workflow-transitions` | Every edge the model drew is stored and accepted, walking each machine breadth-first from its initial state; a move the model never drew is refused with 403 and leaves the record where it was; the API can say which moves are legal from a given state. |
| `11-performance-budget` | Reads stay inside a generous absolute ceiling, and — the part that survives a change of machine — a deep page and a filtered read do not cost proportionally more than an unfiltered first page. |

A new harness module, `harness/model.ts`, carries the model's own `%%enum`
values and `%%workflow … kind: state` edges into the suites as data. This is
what makes the dictionary assertions meaningful: a suite that reads the running
application's dictionary and then asserts against that same dictionary proves
only that the application is self-consistent, and passes just as happily when
the generator dropped something on the floor.

---

## Issues

### ISSUE-001 — Two migrations were written but never scheduled
**Severity:** Critical · **Category:** Data · **Status:** verified

`012_add_workflow_transitions.ts.hbs` and `013_add_report_designs.ts.hbs` were
complete templates that no code referenced. Nothing scans the migrations
directory — the `scaffold` array in `generateMigrations` is the schedule — so
`sys_workflow_transitions` and `sys_report_designs` were never created, and the
two seeds that populate them failed on every single generation:

```
✗ Seed "05b_workflow_transitions.ts" failed: relation "sys_workflow_transitions" does not exist
✗ Seed "06_report_designs.ts" failed: relation "sys_report_designs" does not exist
```

The first of those is what the entity-access guard reads to enforce the state
machine, so its absence meant every state transition in every generated
application was allowed. The gap was known and documented in `CLAUDE.md`.

**Fix:** both slugs added to the `scaffold` array in
`nestjs-backend.generator.ts`, in dependency order after `011_add_operation_access`.

---

### ISSUE-002 — A failed seed reported success and exited 0
**Severity:** High · **Category:** Tooling · **Status:** verified

`runSeeds` in `migrate.ts` caught every seed error, logged it, and continued —
then printed `✓ Seeds completed` and `✅ Database setup completed successfully`
and exited 0. This is why ISSUE-001 survived: the failure was on screen the
whole time and no automation could see it.

**Fix:** genuine failures (anything that is not a unique-constraint violation on
an idempotent re-seed) are collected and re-thrown after the loop, so the run
still reports on every seed but the process exits non-zero.

---

### ISSUE-003 — The state machine was enforced only where a role guard happened to cover it
**Severity:** Critical · **Category:** Correctness · **Status:** verified

With `sys_workflow_transitions` finally populated, the new transition suite
still found illegal moves being accepted: Program `proposed → on_hold`,
Experiment `draft → in_review`, CAPA `open → pending_verification` — none of
which any diagram draws.

Two causes, both in `entity-access.guard.ts`:

- The topology check was nested inside a pass over `sys_transition_access`, and
  returned early when a table had no rows there, or when the write's destination
  was not one a `%%guard` named. drug-discovery guards four of Program's six
  edges; the other two were enforced by nothing.
- The `isMaster` administrator bypass returned before the check ran at all.

The second is a category error. A master role is an escape hatch from *access*
rules — who may do a thing. An edge the diagram never drew is not a permission
an administrator is missing; it is a move that does not exist, and letting it
through puts the record in a state every rule and workflow downstream was
written without.

**Fix:** the two questions are now asked independently — the topology from
`sys_workflow_transitions`, scoped per status column, for every caller including
a master; the role check from `sys_transition_access` afterwards, which the
master bypass still skips. The "valid transitions from X" message also had its
`||` binding to the whole concatenated string rather than the joined list, so a
state with no outgoing edge reported an empty list instead of saying `none`.

---

### ISSUE-004 — The declared transitions were enforced but unreadable
**Severity:** Medium · **Category:** API · **Status:** verified

Nothing exposed `sys_workflow_transitions`. A client had no way to ask which
states a record may move to next, so any screen offering a status change had to
offer all of them and let the save be refused.

**Fix:** `GET /api/workflows/transitions`, optionally narrowed by `?table=` and
`?from=`, returning both a flat list and a by-table grouping. Declared before
`runs/:runId` so the literal path is matched first.

---

### ISSUE-005 — The generated frontend could not produce its route tree
**Severity:** High · **Category:** Build · **Status:** verified

`bun run routes:generate` failed on every generation:

```
error: expected "Route" export to be initialized by a CallExpression
```

Three API route files assigned the call to a local `const route` and exported
both `APIRoute` and `Route` from it. The router's generator parses these files
and requires the `Route` export to hold the call expression directly. A failed
generate leaves no `src/routeTree.gen.ts` — which every route file imports — so
a freshly generated frontend did not typecheck at all.

**Fix:** `Route` now holds the call and `APIRoute` is the alias. Both exports
still exist; only which one is the alias changed.

---

### ISSUE-006 — The report designer's route was replaced by an empty directory
**Severity:** High · **Category:** Correctness · **Status:** verified

`reports.$tableName.tsx` is a file, but it sat in the frontend generator's
`adminSubdirs` list and was handed to `copyDirRecursive`, which created the
destination *before* reading the source. The result was a directory named
`reports.$tableName.tsx` in `src/routes` where the route file belonged. The
designer was shipped and unreachable — exactly what the comment above that list
says the entry exists to prevent — and the only symptom was one warning line
reading `Admin subdir not found`.

The index page beneath it, `admin/reports.tsx`, was never copied at all, so both
the admin landing page and the designer linked to a route that did not exist.

**Fix:** the loop stats the source and copies a file as a file;
`copyDirRecursive` reads the source before creating the destination, so a
failure can no longer leave a directory standing in for a file; and
`admin/reports.tsx` is copied alongside the other admin pages.

---

### ISSUE-007 — A rule authored in the decision-table editor could not be saved
**Severity:** High · **Category:** Correctness · **Status:** verified

`RuleTableEditor`'s `onChange` hands back a `DecisionTable` object;
`jdmContent` is the JSON *text* the rules API stores and every check on the page
parses. Both the new-rule and edit-rule routes passed the state setter straight
in, putting the object into a string state — so the save path's `JSON.parse`
threw and the rule failed validation as "Invalid JDM content", with nothing on
screen to explain why.

**Fix:** serialised on the way out in both routes.

---

### ISSUE-008 — Nine type errors in the generated API route templates
**Severity:** Medium · **Category:** Build · **Status:** verified

Annotating the route handlers' `params` as `Record<string, string>` looked
equivalent to the real type and was not: `ResolveParams<TPath>` has no string
index signature, so every method was rejected as an incompatible callback. These
were invisible until ISSUE-005 was fixed, because until then the frontend could
not get far enough to report anything but missing modules.

**Fix:** `api/$.ts` uses `ResolveParams<'/api/$'>` — its handlers come from a
factory and so get no contextual typing to infer from. `api/auth/$.ts` writes
its handlers inline and now lets inference do it.

With this and ISSUE-006 and ISSUE-007, `tsc --noEmit` on a freshly generated
frontend went from 14 errors to 0.

---

### ISSUE-009 — A second test run against the same database created nothing
**Severity:** Medium · **Category:** Test harness · **Status:** verified

The bulk-seed suite deliberately leaves its rows behind for the suites that
follow, which makes a re-run the normal case. But the faker seed is fixed for
reproducibility, and the seeder salted unique columns with a bare row index —
so the second run regenerated the first run's values exactly and every insert
was refused. The suite reported `0` records created for every entity with a
unique column, which is most of them.

The harness already had a run-scoped salt for precisely this, with a comment
naming the failure; passing an explicit salt bypassed it.

**Fix:** a caller-supplied salt is now folded into the run's identity rather
than replacing it — distinct within a run because the caller's part varies,
distinct between runs because the run token does. The runner pins one token
across its suite processes and prints it; `E2E_RUN_TOKEN` replays a run's values
exactly.

---

### ISSUE-010 — `--records-per-entity` was computed and then dropped
**Severity:** Medium · **Category:** CLI · **Status:** verified

The CLI takes `--records-per-entity <count>`, threads it through
`BunE2ETestGenerator` and into the template context — and `config.ts.hbs` then
ignored it, hardcoding `int("E2E_RECORDS_PER_ENTITY", 1000)`. An application
generated with `--records-per-entity 25` still seeded a thousand rows per
entity, and the only way to get the number asked for was to repeat it at run
time as `--records 25`.

CI's own `generated-app` job is the case that shows what this costs: it passes
`--records-per-entity 25`, saying in a comment that it is "here to prove the
generated application compiles and behaves, not to measure it under load" — and
then ran `bun test` with no environment override, seeding 1000 per entity across
19 entities. Forty times the volume the job asked for, on every run.

**Fix:** the template renders `{{config.recordsPerEntity}}` as the default. The
env var and the runner's `--records` / `--small` / `--full` still override it
for a single run; with neither, an application now seeds what it was generated
to seed. Verified on the `bun test` path CI uses, with no environment set:
an app generated with 300 seeds 300, and one generated with no flag still
defaults to 1000.

---

### ISSUE-011 — `Date.parse` accepted a username as a datetime
**Severity:** Medium · **Category:** Test harness · **Status:** verified

Around three per cent of `User` records failed to insert on every run, which
the bulk seed reported as `created 984/1000 (16 rejected)` and nothing
explained. The backend was answering `400 A value was not valid for its column
type` — Postgres `22007`.

The factory picks a value by field name first and then checks the candidate
against the column's type, falling through when it does not fit. `last_login`
matches the username pattern (`/username|(^|_)(login|handle)(_|$)/`), so the
candidate was `faker.internet.username()` — and the type guard for `datetime`
was `!Number.isNaN(Date.parse(value))`, which let it through:

```
Date.parse("margie_turner33")        -> 2033-03-01
Date.parse("marjorie95")             -> 1995-03-01
Date.parse("lilly.koss-marquardt83") -> 1983-03-01
```

`Date.parse` falls back to a lenient parser that finds a month name and a
number in almost anything, and faker's usernames are full of both. The username
was accepted as a datetime, sent to a `timestamptz` column, and rejected there.

It mattered more than the rate suggests. The bulk-seed suite tolerates a 5%
shortfall, proportionally — so at 1000 records per entity the losses were
invisible, but at the 25 the CI job asks for (see ISSUE-010, which is what made
that number take effect) three rejections out of 25 would fail the suite. The
fix removed a real source of CI flakiness, not just some missing rows.

**Fix:** the `date` / `datetime` guard matches an ISO-8601 shape rather than
trusting `Date.parse`. Every date the factory produces is `toISOString()`,
whole or sliced to ten characters, so nothing legitimate is rejected. Measured
after: 0 rejections in 200 concurrent creates, where the same probe gave 3%
before, and 0 across a full run at 300 records per entity.

### ISSUE-012 — The runner killed a launcher and left the server running

**Severity:** High · **Category:** Test harness · **Status:** verified

A second full run, started straight after a first, failed every suite from
`01-auth` onwards — nine consecutive sixty-second timeouts against a backend
that answered `/api/health` perfectly well. The database was fine; a backend
started by hand against the same database ran all forty-seven suites green.

`run.ts` stops the backend it started in a `finally`, and it does call
`child.kill()`. But the child it holds is `npm run start`, a launcher that
spawns the real server as *its* child:

```
 8220     1  bun run start
 8223  8220  bun run src/main.ts     ← the one holding port 4001
```

SIGTERM reaped 8220 and orphaned 8223, which kept the port. The next run then
found something listening, printed `Attaching to the backend already listening`,
and used it — and that orphan's stderr was still a pipe whose reader, the
previous runner, had exited. `startServer` already knew this hazard: stdout is
discarded and stderr is actively drained, with a comment saying why. What it
could not do was drain a pipe after the process holding it was gone. Sixty-four
kilobytes of request logging later the write blocked, and the backend stopped
answering mid-request while still accepting connections. Health passes, because
it logs almost nothing. Everything else waits out its timeout.

The failure only shows on the second run, presents as nine unrelated suites
timing out, and points at the data volume the first run left behind — none of
which is where it is.

**Fix:** the backend is spawned `detached: true`, into a process group of its
own, and `stop()` signals the group rather than the pid — SIGTERM, then SIGKILL
if the port is still answering after five seconds, because the port is what the
next run collides with and a launcher's exit says nothing about its child. The
group means a terminal's Ctrl-C no longer reaches the backend, so `run.ts`
forwards SIGINT and SIGTERM to `stop()` before exiting. Measured after: two
consecutive runner-managed runs, 47/47 each, nothing left listening between
them.

---

### ISSUE-013 — CI ran an ordered, stateful suite as if it were parallel

**Severity:** Medium · **Category:** CI · **Status:** verified

The `generated-app` job ran the generated suite with `bun test --timeout
180000`, which loads all fifty-one files into one process and runs them
together. The suite is not built for that and says so in its own runner's
header: it is ordered (seed before rules before workflows) and it runs one
process per suite so a crash in one cannot take the rest down.

Run that way, `Deviation Report CRUD > deletes a record and reports what ran`
fails — the delete rolls back because another suite is concurrently holding a
reference to the row, and the endpoint answers `200 {deleted: false}`, which is
the honest report of a delete that did not happen. The same test passes in
isolation under both `bun test` and `node --test`, and passes in the full run
under `run.ts`. Which test fails moves around between runs, because which
suites overlap does.

**Fix:** the job runs `node run.ts --no-server` — the runner the generator
ships and the generated README points at, attaching to the backend the previous
step already started. It also removes the last thing in that job that needed
Bun: the suites have been `node:test` since the wasm port.

---

### ISSUE-014 — A test run's own output was left for the next reader to commit

**Severity:** Low · **Category:** Generator · **Status:** verified

`tests/.e2e-seed-manifest.json` records the row ids one run created on one
database, and `test-results/` holds its metrics reports. Neither was in the
generated `.gitignore`, so both turned up as untracked files after the first
`bun run test:e2e` — inviting a developer to commit one machine's uuids into
everyone's tree, where the next run overwrites them anyway.

**Fix:** both are ignored in the `.gitignore` the generator writes.

---

## Verification

| Check | Result |
|-------|--------|
| `appwithai generate … --run-tests` from an empty directory and dropped database | ✅ 51/51 suites |
| Three consecutive full runs against an accumulating database | ✅ 51/51 each |
| Generated frontend `tsc --noEmit` | ✅ 0 errors (was 14, and before ISSUE-005 could not run) |
| Generated backend `tsc --noEmit` | ✅ 0 errors |
| `bun run type-check` (this repository) | ✅ |
| `bun run lint` (this repository) | ✅ |
| `bun run test` (this repository) | ✅ 512 passed, 6 skipped |
| `bun run test:wasm:cli` — overlay footprint contract | ✅ 16/16 |

Re-verified after ISSUE-012 to ISSUE-014, on CI's bun / linux-x64, with every
job in `ci.yml` reproduced locally:

| Check | Result |
|-------|--------|
| Two consecutive runner-managed runs, `crm`, 250 records/entity | ✅ 47/47 each, nothing left listening |
| `node run.ts --no-server`, `drug-discovery`, the command CI now runs | ✅ 51/51 |
| Generated backend `bun run build` / frontend `bun run build` | ✅ |
| Generated `tests/` `tsc --noEmit`, and every harness module imported under Node | ✅ |
| The four bundle-currency `--check` steps | ✅ all current |
| `bun run test:language-tools` | ✅ 4 models, checker and fixer agree with the CLI |
| Overlay footprint — 9 changed, 0 added beyond the ledger | ✅ |
| `bun run test:wasm` | ✅ 39/39 |

Read performance at ~1,100 rows in the largest table, 15 samples per shape:

| shape | median | p95 |
|-------|-------:|----:|
| first page | 4.7ms | 12.2ms |
| deep page | 4.1ms | 7.8ms |
| single record | 2.5ms | 6.0ms |
| filtered page | 3.6ms | 7.9ms |
| search | 3.5ms | 6.9ms |
| entity metadata | 2.4ms | 7.1ms |
| create (rules + workflows) | 16.2ms | 31.7ms |

The deep page costs no more than the first, which is the claim the budget suite
actually asserts — the absolute numbers belong to this machine.
