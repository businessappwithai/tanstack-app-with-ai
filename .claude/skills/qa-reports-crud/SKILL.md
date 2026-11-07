---
name: qa-reports-crud
description: QA CRUD and reports on both products a model generates — the application (every entity's create, read, update, delete through the browser and the API) and the Enterprise Reporting platform (saved queries, reports, charts, dashboards, per-role access, and the data the seeder loaded). Use when asked to test the downloaded zip under docker compose, check that the reporting application has good data and reports, run CRUD tests, or QA every published model one after another. Companion to qa-lifecycle-workflows, which covers lifecycle, rules and workflows.
---

# QA: CRUD and Reports, on both generated applications

`qa-lifecycle-workflows` holds the state machine, rules, workflows and RBAC
buttons. This skill holds the other half of a generated project: **CRUD on the
application** and **reports on the reporting platform**, and that the two read
the same data. Run both skills for a full pass.

## What is under test

| | Application | Enterprise Reporting |
|---|---|---|
| URL | http://localhost:4000 (API :4001) | http://localhost:3100 |
| Sign-in | `admin@admin.com` / `admin123` | `admin@admin.com` / `admin` |
| Database | `bus_*` tables | `enterprise_config`, loaded by `report-seeder` |
| Source of truth | the model | `reporting/reporting-pack.json`, derived from the same model |

The two sign-ins are separate on purpose. Neither password works on the other
side. `reporting/README.md` in the project lists every role's accounts on both.

## Ground rules

- **Test the zip, not a CLI generation.** Generate through the website
  (`guide/run-in-browser.html#<key>` → Generate → *Download the deployable app
  (.zip)*), unzip, `cp .env.example .env`, `docker compose up --build -d`. That is
  the artefact a reader gets. Models: every `BUILT_IN` key linked from
  `try-it-yourself.html`.
- **One model at a time.** Run to the end, `docker compose down -v --rmi local`,
  then the next. Two stacks side by side fight over ports 4000, 4001, 3100.
- **Drive the UI with clicks only** when asked to test "in the browser": sign in
  once, then reach every screen through the sidebar and row menus. A `goto` to a
  deep URL or a direct API call can pass where the navigation is broken.
- **Wait for the seeder.** `/report` is up but empty until `report-seeder` has
  exited 0. Read its log: `[seed] saved queries / reports / charts / dashboards
  (N widgets) / reporting roles` is the first thing to compare with the pack.
- **Do not edit the zip's source to get green.** If something has to be patched
  to run (see *In a sandbox*), patch only the QA copy and report it.

## Phase 1 — the seeder and the data

```bash
docker compose ps -a                       # report-seeder Exited (0), the rest healthy
docker compose logs report-seeder | grep '\[seed\]'
docker compose exec -T postgres psql -U app -d <db> -Atc \
  "select relname, n_live_tup from pg_stat_user_tables where relname like 'bus_%' order by 2 desc"
```

Pass when: the seeder exited 0; the queries, reports, charts, dashboards and
roles it printed equal the counts in `reporting/reporting-pack.json`; every
`bus_` table the pack names exists; the application holds sample rows (record
how many per entity — a zip seeds only a handful, so every report will show
single digits, which is expected).

## Phase 2 — CRUD on the application

Per entity, in the browser (sidebar → entity):

1. **List** renders rows, the search box filters, a column sort changes order,
   pagination moves (when there is more than one page).
2. **Create** through the form: required fields enforced, a reference field offers
   the parent's display value (not a uuid), an enum field offers only the model's
   `%%enum` values. Save; the row appears in the list.
3. **Read** — open it; every field shows the value saved.
4. **Update** — change one field, save, reopen. `version` has gone up.
5. **Conflict** — open the same record in two contexts, save in the first, save in
   the second: the form offers Reload their version / Overwrite with mine / Keep
   editing (409 `VERSION_CONFLICT`).
6. **Delete** — the row leaves the list. A record in a Final state refuses with
   409 `RECORD_FINAL`; a parent with children is refused or cascades as the model says.

For depth beyond the click path, run the generated API suite inside the project
(it is derived from the model — never rewrite what it expects):

```bash
docker compose --profile test run --rm e2e          # every suite
bun run test:crud                                    # 03-crud.<entity>, one per entity
bun run test:reporting                               # 28-reporting-platform
bun run test:together                                # 29-app-and-reports-together
```

Run the suites **twice** on one database; the second run is the one that finds
unique constraints. Suites that matter here: `03-crud.<entity>`, `14-validation`,
`16-api-contract`, `17-display-identifier`, `22-optimistic-locking`,
`21-reports` (the application's own Analysis screen), `28`, `29`.

## Phase 3 — reports on Enterprise Reporting

Sign in as the administrator and reach each screen from the sidebar.

1. **Home** — Reports / Charts / Dashboards counts equal the seeder's.
2. **Reports** — open a report (row menu → View). The table shows rows, not an
   error. Open at least one **authored** report (a `%%report` from the model) and
   one **derived** one. `Refresh` re-runs it.
3. **Charts** — open one of each type the list holds: **bar, pie, line** at a
   minimum. The Type column is the last data column of the list. A chart with no
   rows is a finding unless the pack says its query returns none.
4. **Dashboards** — open one; every widget draws data, none shows an error or a
   spinner that never ends. Check a dashboard from a narrow role as well.
5. **Data Sources** — the application's database is there and its schema is
   cached (the seeder printed the table count).
6. **Parity with the application** — create a record in the application (Phase 2),
   then press Refresh on the matching register report: the count rose by one.
   Suite `29` automates this; do it once by hand per model.

### Roles — what a reporting role may read

Sign in as a second reporting account (addresses are in `reporting/README.md`,
`<role>@<app>.reports.example.com`, password `admin`).

- It sees only the sidebar items its role grants (Dashboard, Reports, Charts,
  Dashboards, NL Query); no Administration section.
- A report that reads a table the role does not hold answers **403 naming the
  tables**, not an empty table and not a crash.
- `tables: []` in a pack role means *every table for the administrator only*.
- Sign-in is rate limited (5 a minute): one client per account, no sign-out loops.

## Method — borrowed from gstack's `/qa`

[gstack](https://github.com/garrytan/gstack)'s QA skill is a good shape for the
run, and the parts worth keeping are method, not tooling. (Its installer, shell
helpers and telemetry are not used here.)

1. **Baseline first.** Run every phase above and *report* what failed before
   changing anything.
2. **Triage by severity**: Critical (stack will not start, seeder fails, data
   loss), High (a report, chart or dashboard errors; CRUD broken on an entity),
   Medium (wrong numbers, wrong labels, a role sees too much or too little),
   Low (layout, copy). Name the layer, not just the symptom.
3. **Evidence per issue**: a screenshot of the failing state and the reproduction
   steps; after a fix, an "after" screenshot taken the same way.
4. **Reproduce before repair.** A fix starts from a minimized replay and a causal
   hypothesis. An environment failure (rate limit, TLS, out of disk) is not a
   product bug and authorises no repair.
5. **Never weaken a test to get green.** A new regression test goes in a new
   native test file beside the code it covers.
6. **Stop and ask** after two reverts, or when a fix needs a file unrelated to
   the finding. Fixes are made upstream in `app-with-ai-tanstack` and carried to
   the other repositories with `sync-downstream`, never in the generated zip.
7. **Keep browser and API outcomes separate** in the report; do not blend them
   into one score.

## Reporting

One block per model, in the order run:

```
<model>  zip <files> · build <mm:ss> · seeder <exit> · queries/reports/charts/dashboards (widgets)/roles
         app: <n> entities, <n> rows · CRUD: list/create/read/update/conflict/delete pass|fail
         reports: report | chart bar/pie/line | dashboard  pass|fail · role check pass|fail
         screenshots: <paths>
```

Name each failure by layer — **seeder, pack, data, report SQL, chart, dashboard,
role access, CRUD, optimistic locking** — and whether it reproduces on a second
run. Show screenshots of the first model in full; for the rest, one dashboard,
one report and one chart each is enough.

## In a sandbox

- The build containers may not trust an egress proxy's certificate: `git clone`
  and `bun install` fail inside the image build with *certificate signer not
  trusted*. Append the proxy's CA to each stage's `/etc/ssl/certs/ca-certificates.crt`
  in the **QA copy** of the Dockerfiles and set `NODE_EXTRA_CA_CERTS`. Never
  disable verification.
- **Docker Hub rate limits (429)** stop a loop that deletes base images between
  models. Keep them (`down -v --rmi local` only removes the project's own) and
  prune build cache by size, not `-af`.
- A frontend image build peaks near 6 GB; a very large model (200 entities) can
  take far longer than the CRM. Budget the wait and say so rather than killing it.
