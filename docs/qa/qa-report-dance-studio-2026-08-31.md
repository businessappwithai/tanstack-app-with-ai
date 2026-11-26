# QA Report — dance-studio (CLI generator + generated application)

**Date:** 2026-08-31
**Method:** the gstack `/qa` skill, Standard tier, applied to a generated application
**Target:** the `appwithai` CLI, `packages/generator/src`, `packages/generator/templates`, `packages/core`
**Source model:** `language/examples/dance-studio.eml.mmd` — 9 entities, 10 relationships,
5 categories, 7 enums, 2 state machines, 1 saga, 21 `%%rbac` restrictions
**Branch:** `claude/qa-gstack-generator-dance-studio-qr619s`
**Stack:** TanStack Start + React 19 (frontend), NestJS + Fastify + Kysely (backend), PostgreSQL 16

Every fix lands in the generator, so every generated application picks it up —
not just this output. Follow-up to `qa-report-drug-discovery-2026-08-28.md`;
none of that pass's issues had regressed, and the state-machine topology guard
it added still refuses an undrawn edge (verified below).

---

## Summary

| Severity | Found | Fixed | Deferred |
|----------|------:|------:|---------:|
| Critical | 2      | 2      | 0        |
| High     | 5      | 5      | 0        |
| Medium   | 6      | 6      | 0        |
| Low      | 1      | 1      | 8        |
| **Total**| **14** | **14** | **8**    |

**Health score: 53 → 86.**

### Top 3

1. **No generated application could talk to its own API.** All three API route
   files ended `export const APIRoute = Route`, and vinxi's `?pick=APIRoute`
   pass deletes the other exported declarator outright — so every `/api/*`
   request through the front end's own origin answered 500 with
   `ReferenceError: Route is not defined`. Sign-in, permissions and every entity
   screen (ISSUE-001, critical).
2. **No entity with a required boolean could be created from the interface.** A
   Yes/No field starts `undefined`, its checkbox draws `undefined` as unticked,
   and the validator counts the answer the user is looking at as missing —
   refused with "Please fix the validation errors" and nothing beside any field,
   because the Yes/No branch renders neither the required marker nor the error.
   Room, Instructor and Member, on this model (ISSUE-013, critical).
3. **The sample data contradicted the model it came from.** All seven
   enum-bound columns were seeded from one hard-coded list — a Member was
   `Active`/`Pending`/`In Progress`/`Completed` where the model declares
   `active, lapsed, suspended` — so every state-machine record started outside
   its own diagram with no declared transition out of it, and every integer
   column held the row index, giving rooms a capacity of 0 (ISSUE-003,
   ISSUE-014).

Two of the fourteen were found only by looking at the running application
rather than by running its tests: the uuid record titles (ISSUE-005) and the
dashboard offering every role every entity (ISSUE-009). The generated suite was
green on both.

---

## Method

1. Generated with the CLI:
   `node packages/generator/dist/cli/generate.js generate -i language/examples/dance-studio.eml.mmd -o generated-projects/dance-studio -n dance-studio --force`
   which runs install → migrate → seed against a local PostgreSQL 16.
2. Ran `validate` and `inspect` over the same model and read what they said.
3. Booted both halves and drove the application in Chromium (Playwright,
   1440×900): sign-in, the dashboard, every entity list, a record, the create
   form, and one round trip per seeded role account.
4. Exercised the API directly for the things a browser cannot show — the
   state-machine guard, role enforcement, the create path the form was refusing.
5. Fixed each finding in the generator, one commit per issue, regenerated from
   scratch and re-verified.
6. Closed with a single clean CLI run: `--run-tests-fast`, then `tsc --noEmit`
   in both halves of the output and `bun test` / `bun run type-check` /
   `bun run test:wasm:cli` in this repository.

---

## Findings

### ISSUE-001 · critical · every `/api/*` request answered 500

`frontend/src/routes/api/$.ts`, `api/auth/$.ts` and `api/copilotkit/$.ts` each
ended:

```ts
export const Route = createAPIFileRoute('/api/$')({ … })
export const APIRoute = Route
```

vinxi imports an API route file as `?pick=APIRoute`, and its tree-shake pass
(`vinxi/lib/plugins/tree-shake.babel.js`) removes every *other* exported
declarator outright rather than inlining it. The picked module was therefore
left holding `export const APIRoute = Route` with `Route` deleted:

```
Error importing route file: ReferenceError: Route is not defined
    at eval (…/src/routes/api/$.ts?pick=APIRoute:4:18)
```

answered as 500. `GET /api/me/permissions`, `/api/auth/get-session` and
`/api/bus/:entity` all failed; the same requests against the backend on :4001
answered 401, as they should.

**Fix.** Each export holds its own `createAPIFileRoute(...)` call over one
shared, non-exported `methods` object. `APIRoute` then stands alone under the
pick, and `Route` is still initialised by a call expression directly, which is
what the route generator requires. Verified: 500 → 401/200 on all three routes.

### ISSUE-002 · high · `bun run type-check` broke the generated frontend

`routes:generate` shelled out to `bunx --bun @tanstack/router-cli@1.132.0`,
thirty-five minor versions ahead of the `@tanstack/react-router` and
`@tanstack/start` 1.97.1 the application actually runs. 1.132 has no separate
API-route concept, so it wrote `src/routes/api/**` into `src/routeTree.gen.ts`
as ordinary routes — 39 references where the dev-time plugin writes none — and
1.97's runtime then died on `Route.update is not a function`, 503 on every page.
`pretype-check` runs it, so the documented way to check types was enough to
break a working dev server.

**Fix.** Install `@tanstack/router-cli` at 1.97.1 beside the router it belongs
to and call the local `tsr generate`. Its output is byte-identical to what the
dev-time plugin writes.

### ISSUE-003 · high · sample rows contradicted every `%%enum`

The business-data seed picks values by column *name*, so every column called
`status` got `Active / Pending / In Progress / Completed` whatever the model
declared:

| column | seeded | declared |
|---|---|---|
| `Member.status` | Active, Pending, Completed, In Progress | active, lapsed, suspended |
| `ClassSession.status` | the same four | scheduled, running, completed, cancelled |
| `Booking.status` | the same four | held, attended, cancelled, forfeited, no_show |
| `WaitlistEntry.status` | the same four | waiting, promoted, expired |
| `ClassPack.status` | the same four | active, exhausted, expired |
| `ClassOffering.level` | Level 1..4 | beginner, improver, intermediate, advanced |
| `Payment.method` | Method 1..4 | card, cash, bank_transfer |

Not one of those values is in `sys_ref_list`, so the grid showed a value the
dropdown could not select and every state machine began outside its own diagram.

**Fix.** The parser already puts the declared values on the attribute as
`enumValues`; seed from them, cycling, so the four sample rows cover the enum.

### ISSUE-004 · medium · one date rendered two ways on adjacent screens

The grid formats with date-fns as `dd/MM/yyyy`; the record form and the
dictionary detail shell called `toLocaleDateString()`. `Member.joined_on` read
`15/01/2000` in the list and `1/15/2000` one click later — under a format that
also follows whichever locale the runtime holds, so it can differ between the
SSR pass and the browser. Both now use the grid's formats.

### ISSUE-005 · high · every record was titled by its own uuid

`use-bus-entity-level` picks a record's display value from the dictionary's
identifier columns — `f.is_identifier && !f.is_key && !f.ref_table_name` — but
`/bus/:entity/fields/{form,grid}` never sent `is_identifier` or `is_key`. The
filter matched nothing on every entity, the guessed-name fallback list did not
contain `full_name`, and the title fell through to the record id:

```
← List | 1a498937-ac17-421f-a427-1a2a329298c2   DRAFT
```

on a Member whose dictionary row marks `full_name` as the identifier. The same
value heads the breadcrumb and the record navigator, so all nine entities were
unreadable by name. Selecting both columns in `getEntityMetadata` fixes it:
the header now reads `James Smith`.

### ISSUE-006 · medium · foreign key columns were labelled "… Id"

A Table Direct column stores a uuid and displays the referenced record, so the
Booking grid read `Class Session Id | Member Id | Class Pack Id` over three
columns showing none. `sys_column.name` was `formatDisplayName(column_name)`
with the suffix left on. Stripped for a resolved Table Direct; the primary key
still reads "Id" and `created_by` still reads "Created By".

### ISSUE-007 · high · the "mandatory linting check" could never pass

It ran at the end of `FullStackGenerator.generate()`, before the CLI's install
step, in a directory with no `node_modules`. `npm run lint` could not find
biome, exited non-zero, and the check printed *"Backend linting found issues"*
on every generation about code it had never read — both halves, every time,
whatever the model. Moved to `utils/lint-check.ts` and called from the CLI after
the install, honouring `--package-manager`; where there is still no
`node_modules` it says the check was skipped.

The same run's closing line advertised `admin@admin.com / admin`. The bootstrap
default is `admin123` and Better Auth's `minPasswordLength` is 8, so the first
password a reader tried could never have worked.

### ISSUE-008 · medium · every sample record wore a DRAFT badge

`doc_status` is `NOT NULL DEFAULT 'draft'` and set to `'final'` by the promotion
the API runs after a write. The seed inserts straight into the table, so all 36
sample rows kept the default and the header of every screen read `DRAFT` on
data that is complete. Seeded final.

### ISSUE-009 · high · the dashboard offered every entity to every role

`EntityAccessGuard` enforces `%%rbac … .read` on the data correctly — a
`user@` request for `bus_payment` answers 403 with the roles it would need. But
the two endpoints the dashboard builds its navigation from,
`/sys/categories/with-entities` and `/sys/tables`, did not, so every account saw
all nine entities and opening one answered 403. The seeded `user@` account,
which the sign-in screen itself describes as "0 of 9 entities", was offered all
nine.

Both are now filtered by the caller's readable `bus_` tables, exempting a master
role and leaving `sys_` tables alone; `/sys/tables` is paginated after the
filter rather than before it. A category whose every entity belongs to another
role is dropped rather than shown as a card reading "0", and a role that may
read nothing is told so instead of being shown a blank page.

Verified against the model, and against the counts the sign-in screen
advertises:

| account | categories offered | entities |
|---|---|---:|
| `instructor@` | Membership, Scheduling, Teaching | 4 |
| `member@` | General, Membership, Scheduling, Teaching | 7 |
| `receptionist@` | all five | 9 |
| `manager@` | all five | 9 |
| `admin@admin.com` | all five | 9 |
| `user@` | — | 0 |

### ISSUE-010 · medium · the multi-step workflow suite stamped into an email column

`stampableFields` picks any long writable string column to write the suite's
marker into. Generation also writes a decision-table row for any column named
`email` — `!contains(email, "@")` → prevent — so on a model whose first such
column is an email the create was refused *400 Business rule validation failed:
Email must be a valid email address*, and two of the four tests failed pointing
at the workflow, which had never started. 29/30 on this model; 30/30 with
format-constrained columns excluded.

This is the same class as the `firstTextField` fix recorded in `TODOS.md` on
2026-08-28, recurring in a different helper.

### ISSUE-011 · medium · `validate` reported five real entities as missing

The FK check folded case but not the naming convention — the column is
`class_offering_id`, the entity is `ClassOffering` — so every multi-word entity
looked unresolvable. Five warnings on a model the language specification
publishes as clean. Compared with the underscores removed; the model now
validates with no issues found.

### ISSUE-012 · medium · a relationship's foreign key was named after the wrong end

`generateForeignKey` derived the column from the relationship's target
regardless of direction. For `A ||--o{ B` the column lives on B and is named
after A, so the parser produced `b_id` — a column named after the table it sits
on. `inspect` printed it verbatim and disagreed with every line of the ERD it
had just parsed (`ClassOffering ||--o{ ClassSession` via `class_session_id`;
declared `class_offering_id`), and `generators/wasm/model-bundle.ts` carries a
workaround for exactly this. Named after the one side; `inspect` now agrees with
the model on all ten relationships and the workaround becomes a no-op.

### ISSUE-013 · critical · an entity with a required boolean could not be created

Described in the Top 3. The API accepted the identical payload, so nothing in
the message pointed at the cause. The value the control is already showing is
now seeded on create, and the boolean field carries the required marker and the
error message every other field has. Verified: a Room saves from the form with
the box left unticked and stores `is_active = false`, and with it ticked stores
`true`.

### ISSUE-014 · low · integer columns were seeded with the row index

Every integer got 0, 1, 2, 3. `Room.capacity`, whose help text calls it "the
ceiling a session's bookable places are set from", was seeded 0 — and the
sessions in those rooms held nobody while carrying four bookings each.
`seedValue` already had a vocabulary for `capacity`; integers never reached it.
Rooms now seed 20/25/30/35, class packs 10/15/20/25 credits, sessions 45/60/75/90
minutes.

---

## Deferred

Each of these is real and none is fixed here. The first is the largest.

| # | Severity | Finding |
|---|---|---|
| D1 | medium | **`lint` writes.** Both generated `package.json`s define `lint` and `lint:fix` as the same command, `biome lint --write src` — so the lint script mutates the tree, and the generated `ci.yml` "lint" job passes anything biome can auto-fix. Making `lint` read-only is one line; what it exposes is not: a freshly generated application carries **71 backend and 162 frontend findings**, led by `useNodejsImportProtocol` (17), `noParameterAssign` (13), `useLiteralKeys` (28), `useTemplate` (35), and — the ones that matter to a reader — `useButtonType` (30), `noLabelWithoutControl` (6), `useKeyWithClickEvents` (5). Flipping the script without clearing the findings would ship every generated repository with red CI, so the two belong in one deliberate piece of work rather than in a QA pass. |
| D2 | medium | **A join entity's display value is two raw uuids.** §3.7 says a join entity is labelled by its first two parents *resolved through their labels*, joined with an em dash. `ClassSession` (three FKs, no name of its own) renders as `e70aa920-… · 04aa63ca-…`: the NestJS stack reads the referenced record's identifier columns but does not resolve them one level further, and joins with a middle dot. |
| D3 | medium | **A list the caller may not read says "No records found".** Navigating directly to `/payment` as `user@` shows an empty grid and *"Click + to create a new payment"* — the 403 is swallowed. ISSUE-009 removed the link; the address still answers misleadingly. |
| D4 | low | **`ClassPack` is labelled by its status.** It has one FK and no name or code, so the §3.7 ladder falls to "first text column", which is the enum-bound `status` — every pack reads "active" or "exhausted". Spec-conformant and still the worst available label; skipping enum-bound columns in that step is the obvious repair, but it changes a ladder `scripts/check-spec.mjs` asserts and belongs with a spec change. |
| D5 | low | **`validate` still warns on `*_by_id` and role-named FKs.** `approved_by_id`, `owner_id`, `manager_id`, `pi_id` — seven warnings on `crm`, seven on `drug-discovery`. `_by` columns are accepted by `isForeignKeyColumnName` and rejected by `resolveRefTableName`; the two disagree, and until they are reconciled the warning is arguably true. |
| D6 | low | **Sample bookings are internally implausible.** `booked_at` and `cancelled_at` are the same timestamp on every row, and `fee_waived` is true on a booking still `held`. The datetime and boolean cases of the seed do not consult the column name the way strings and (now) integers do. |
| D7 | low | **The dictionary sync logs an error on every page.** With `ELECTRIC_URL` unset — the documented default, where the frontend is meant to fall back to the HTTP API — `@tanstack/electric-db-collection` throws `TypeError: Failed to construct 'URL': Invalid URL` for each of `sys_window` and `sys_table`. The fallback works; the console does not say so. |
| D8 | low | **The TanStack Query devtools button overlaps "Add note".** Dev-only (the library no-ops unless `NODE_ENV=development`), and its default corner is the corner the record screen puts a button in. |

Not a finding, recorded so the next pass does not re-diagnose it: `04-bulk-seed`
times out at 60s on this container (4 cores) while writing 1000 records across
nine entities. It is the suite `--run-tests-fast` deliberately skips, and it is
a machine limit rather than a defect.

Two model-quality notes, which belong to `language/examples/dance-studio.eml.mmd`
rather than to the generator: `WaitlistEntry` is named by no `%%category`, so it
lands under "General"; and the dashboard orders categories alphabetically, which
puts that group second rather than last.

---

## Verification

One clean CLI run, generation through tests, on linux-x64 /
PostgreSQL 16.13:

| Check | Result |
|-------|--------|
| `generate … --run-tests-fast` — generate, install, migrate, seed, test | ✅ exit 0, **30/30 suites** in 34.0s |
| Generated backend `tsc --noEmit` | ✅ |
| Generated frontend `bun run type-check` (routes:generate + tsc) | ✅ |
| `bun test packages/core packages/generator/src` | ✅ 279/279 |
| `bun run type-check` (this repository) | ✅ |
| `bun run test:wasm:cli` | ✅ 16/16 |
| `validate language/examples/dance-studio.eml.mmd` | ✅ no issues found (was 5 warnings) |
| `inspect` — Via column against the ERD | ✅ all 10 relationships agree |

Browser, against the regenerated application:

| Check | Result |
|-------|--------|
| `/api/me/permissions`, `/api/auth/get-session`, `/api/bus/member` through :4000 | ✅ 401 / 200 / 401 (was 500 / 500 / 500) |
| Sign in as administrator → dashboard, 9 entities in 5 categories | ✅ |
| Member record header and breadcrumb | ✅ `James Smith`, badge `FINAL` |
| `joined_on` in the grid and on the record | ✅ `15/01/2000` in both |
| Booking grid headings | ✅ Class Session / Member / Class Pack |
| Create a Room from the form, box unticked | ✅ saved, `is_active = false` |
| Create a Room from the form, box ticked | ✅ saved, `is_active = true` |
| Six seeded accounts, entities offered | ✅ 4 / 7 / 9 / 9 / 9 / 0, matching the sign-in screen |
| Seeded enum values against `sys_ref_list` | ✅ all seven columns inside their enum |

The state-machine topology guard added by the previous pass still holds — it is
the claim `llms-full.txt` §5.2 makes, so it is re-checked every time:

```
PATCH bus_booking {"status":"completed"}   → 403  no edge from 'held' to 'completed'.
                                                  Valid: attended, cancelled, forfeited, no_show
PATCH bus_booking {"status":"banana"}      → 403  (same)
PATCH bus_booking {"status":"attended"}    → 200  doc_status: final
```

---

## Health score

| Category | Weight | Before | After |
|---|---:|---:|---:|
| Console | 15% | 10 | 70 |
| Links | 10% | 100 | 100 |
| Visual | 10% | 73 | 92 |
| Functional | 20% | 0 | 92 |
| UX | 15% | 61 | 84 |
| Performance | 10% | 100 | 100 |
| Content | 5% | 85 | 97 |
| Accessibility | 15% | 69 | 69 |
| **Weighted** | | **53** | **86** |

Accessibility is unchanged on purpose: every finding in it is inside D1, and
clearing them is that piece of work rather than this one.

**PR summary:** QA found 14 issues, fixed 14, health score 53 → 86.
