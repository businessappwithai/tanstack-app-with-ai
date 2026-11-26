# TODOs - HMS OpenUI5/OData V4 Enhancement

Work deferred from the Better Auth + Trigger.dev + GoRules enhancement plan.

> **Status audit, 2026-07-31.** These items were written against an HMS app built
> on OpenUI5 + OData V4. This repository generates TanStack Start + NestJS and has
> no OData layer and no `BaseEntityController`, so items 1 and 4 no longer map onto
> the code as written. Current state:
>
> | # | Item | Status |
> |---|------|--------|
> | 1 | Row-Level Security | **Needs re-scoping** — see note below |
> | 2 | Rate limiting on auth endpoints | ✅ **Done** (2026-07-31) |
> | 3 | JDM Editor self-hosting | ✅ **Already done** — bundled from npm, no CDN |
> | 4 | Dead letter queue | **Blocked** — external (Trigger.dev plan) |

---

## 1. Row-Level Security (RLS)

> **Re-scoping needed.** The implementation below targets `BaseEntityController`
> and OData queries, neither of which exists here. Two candidate homes for this
> work in the current architecture:
> 1. **This app's own data** — `projects` already has a membership model
>    (`routes/api/projects/$id/members/`); ownership filtering would go in the
>    project API routes and `database.service.ts`.
> 2. **Generated apps** — the NestJS `bus` module templates under
>    `packages/generator/templates/tanstack-start-nestjs/backend/src/modules/bus/`,
>    which do have `sys_access` / `sys_user_role`.
>
> These are different pieces of work. Decide which before starting.

**What:** Add `created_by`/`updated_by` filtering to OData queries so users can only access their own records.

**Why:** Current RBAC checks entity type permissions (can User X read Patients?) but not record ownership (can User X read THIS patient?). This allows horizontal access - Alice can read Bob's patients.

**Pros:**
- Closes security gap (horizontal access prevention)
- Industry standard for multi-user systems
- Aligns with Better Auth user model

**Cons:**
- 4h effort (adds `WHERE created_by = :userId` to all OData queries)
- Impacts every query (small performance overhead)
- Requires sys_access schema redesign (add row_level_security flag)

**Context:**
- Current state: BaseEntityController has no ownership filtering
- Implementation: Add `injectOwnershipFilter()` method to BaseEntityController
- Use `created_by` field (added in migration 007)
- Only apply to non-admin users (check sys_user_role)

**Depends on:**
- Phase 1 migrations (created_by fields must exist)
- Better Auth integration (user.id available in req.user)

**Blocked by:** None

---

## 2. Rate Limiting on Auth Endpoints — ✅ DONE (2026-07-31)

**Implemented in** `packages/web/src/lib/rate-limit.ts`, applied to
`routes/api/auth/login.ts` (10/min per IP) and `routes/api/auth/register.ts`
(3/min per IP). Returns 429 with `Retry-After` and `RateLimit-*` headers.
Covered by `packages/web/src/lib/__tests__/rate-limit.test.ts` (15 tests).

Deviation from the plan below: `express-rate-limit` was not used. The auth
endpoints are TanStack Start server handlers taking a Web `Request` and returning
a `Response`, not Express middleware, so the package does not apply. The
replacement is a dependency-free in-memory fixed-window limiter with the same
semantics.

**Remaining limitation:** counters are per-process and reset on restart. Move the
`buckets` map to Redis before running more than one instance.

<details>
<summary>Original plan</summary>

**What:** Add `express-rate-limit` middleware to `/api/auth/*` endpoints (10 attempts per minute per IP address).

**Why:** No protection against brute force login attacks. Attacker can try unlimited passwords.

**Pros:**
- Industry standard security practice
- Simple to implement (middleware config)
- Prevents credential stuffing attacks

**Cons:**
- 2h effort (minimal)
- May block legitimate users on shared NAT (corporate networks)

**Context:**
- Use `express-rate-limit` package (already compatible with NestJS)
- Config: 10 attempts/min for `/api/auth/signin`, 3 attempts/min for `/api/auth/signup`
- Store in Redis for distributed rate limiting (or in-memory for single-server)

**Depends on:** Phase 2 (Better Auth integration complete)

**Blocked by:** None

</details>

---

## 3. JDM Editor Self-Hosting — ✅ ALREADY DONE

`@gorules/jdm-editor` is a declared dependency of `@appwithai/web` and is imported
directly as an ES module in `packages/web/src/components/workflow/GoRulesEditor.tsx`:

```ts
import "@gorules/jdm-editor/dist/style.css";
import { DecisionGraph, JdmConfigProvider } from "@gorules/jdm-editor";
```

There is no `cdn.jsdelivr.net` script tag anywhere in the repository, so the
supply-chain risk this item describes does not exist. The webpack work below is
moot — the editor is bundled by Vite as part of the normal build.

<details>
<summary>Original plan</summary>

**What:** Install `@gorules/jdm-editor` via npm and serve from `/static/jdm-editor.js` instead of loading from CDN.

**Why:** CDN dependency creates supply chain risk. If CDN is compromised, attacker can inject malicious JavaScript into admin interface (RCE).

**Pros:**
- Removes external dependency
- Better security (no third-party code at runtime)
- Offline support (editor works without internet)

**Cons:**
- 3h effort (webpack config for React build)
- Adds ~2MB to bundle size
- Must manually upgrade editor version (no auto-update from CDN)

**Context:**
- Current: `<script src="https://cdn.jsdelivr.net/npm/@gorules/jdm-editor"></script>`
- Target: `<script src="/static/jdm-editor.js"></script>`
- Requires webpack config to bundle React component
- May conflict with OpenUI5's own build system (test carefully)

**Depends on:** Phase 5 (JDM Editor iframe wrapper exists)

**Blocked by:** None

</details>

---

## 4. Dead Letter Queue for Failed Workflows — BLOCKED

Still blocked, and for the reason the item already records: DLQ availability
depends on the Trigger.dev account plan, which is an external decision.

Scope note: Trigger.dev appears in this repository only inside the **generated**
NestJS templates (`backend/src/modules/jobs/job-queue.service.ts.hbs`,
`modules/bus/promotion-dispatcher.service.ts.hbs`). The "AdminWorkflows view"
below refers to the HMS app, not `routes/admin/workflows/` here. Confirm the
target app and the plan before starting.

**What:** Configure Trigger.dev dead letter queue to persist workflows that fail after 3 retries. Surface in AdminWorkflows view.

**Why:** Current behavior: workflow retries 3x, then disappears. Admins see error_details but can't retry from UI. DLQ ensures failed workflows are never lost.

**Pros:**
- Production reliability (no silent data loss)
- Trigger.dev built-in feature (minimal implementation)
- Enables bulk retry (process all DLQ items at once)

**Cons:**
- 2h effort (config + UI updates)
- May require Trigger.dev plan upgrade (DLQ not available in free tier)
- DLQ storage costs if many failures

**Context:**
- Trigger.dev DLQ config: `deadLetterQueue: { enabled: true }`
- AdminWorkflows view: add "Failed (DLQ)" filter
- Show count: "12 workflows in dead letter queue"
- Retry button: re-queue from DLQ

**Depends on:**
- Phase 3 (Trigger.dev workflow system complete)
- Trigger.dev paid plan (verify DLQ availability)

**Blocked by:** Trigger.dev plan limits (check with Trigger.dev account)

---

## Deferred (Not TODOs - Explicitly Rejected)

These items were considered but explicitly rejected:

- ~~**Audit logging**~~ - superseded: shipped and verified end to end, 2026-07-31. `audit_log` is created by migration `0007`, `AuditInterceptor` records every bus mutation, and `/admin/audit` reads it with filters and a before/after diff.
- **Multi-tenancy** - HMS is single-hospital system, no use case
- **Workflow scheduling** - No time-based triggers identified
- **Rule versioning** - Admin can duplicate rules manually
- **Bulk operations** - OData $batch is complex, unclear use case

---

## Found by /qa on `claude/drug-discovery-mmd-qa-nc8d0b`, 2026-07-30 — RESOLVED

All four deferred findings fixed on main, 2026-07-30:

- **Database consistency** — Init panel placeholder/default changed to `postgresql://…:5432/…`; helper text updated; `.env.example` switched to PostgreSQL vars (`PGHOST`, `PGPORT`, etc.); `database.service.ts` header comment updated from MariaDB to PostgreSQL.
- **EML `%%rule` ingestion** — `extractRuleFlowcharts()` added to `rules-design.tsx`; on first load the editor now seeds from the first `%%rule` flowchart in `project.erdCode` instead of the hardcoded "Order Discount" placeholder.
- **`(round)` node shape** — `NodeShape` union extended with `"round"`; `parseNodeDef` branch added for `^\((.+?)\)` in `mermaid-flowchart-parser.ts`.
- **Console pipe amplification** — `routes/api/db/reverse-engineer.ts` and `generate-schema.ts` migrated from `@tanstack/start/api` (deprecated, emits `console.warn` on every load) to `@tanstack/start-api-routes` (the underlying package, no warning); `@tanstack/start-api-routes` added as an explicit web dependency.

---

## Found by /qa on `claude/drug-discovery-categories-qa-fon34w`, 2026-07-31 — RESOLVED

Ten defects found driving the generated drug-discovery app (17 entities, 7 categories)
against PostgreSQL. All fixed in the generator templates, so every generated app picks
them up. Full report with evidence: [docs/qa/qa-report-drug-discovery-2026-07-31.md](docs/qa/qa-report-drug-discovery-2026-07-31.md).

- **`generate --force` broke `bun run migrate`** — scaffold migrations were named
  `<Date.now()>_<slug>.ts` and the cleanup pass removed only three of eight slugs, so a
  regeneration emitted a fresh set alongside the old and the runner replayed CREATE
  TABLE migrations. Now a fixed zero-padded sequence, overwritten in place.
- **`bun run migrate` never ran the seeds** — `src/migrate.ts` looked in `src/seeds`;
  they are generated at the backend root. Silent: it reported success with an empty
  Application Dictionary.
- **Unhandled ElectricProvider sync error on every load** — booted PGlite with
  `VITE_ELECTRIC_URL` unset, which is the shipped default and already covered by the
  HTTP fallback. Now idle when Electric is not configured.
- **Duplicate TanStack Query keys from `useQueries`** — `DynamicTable` keyed lookups by
  referenced table, so two FKs to the same table collided and shifted every later result
  onto the wrong field. Same in the breadcrumb shells. Both now dedupe.
- **Google Fonts was a hard runtime dependency** — a render-blocking third-party
  stylesheet. Latin subsets vendored under `frontend/public/fonts` (SIL OFL).
- **FK columns rendered raw UUIDs** — the shipped `.tsx` DynamicTable ignored
  `ref_label_fields` and defaulted to `"name"`.
- **Category selects on `/admin/categories` were unreadable** — `.swiss-input` kept
  `py-3` under every height override, clipping the text to a band shorter than the glyphs.
- **Dashboard header overflowed at 375px** — fixed-width search box.
- **Audit trail recorded a `promotion` column that does not exist** — the interceptor
  diffed the raw response envelope. Also added the missing `audit_log` migration.
- **"1 records"**, and the frontend `dev` script rendered as `vinxi dev --port ` with no
  port because `config.frontendPort` was never in the template context.

### Not fixed — model authoring, not a defect

`drug-discovery.eml.mmd` declares `booked_by`, `reported_by` and `registered_by` as
plain strings rather than `_id`-suffixed foreign keys, so the generator cannot derive
the referenced table and those columns render as UUIDs. The EML checker already flags
this as `EML114`. Renaming them in the model is the fix.

---

## Found by the generated E2E suite, 2026-07-31 — RESOLVED

Ran the generated `tests/` suite against the running drug-discovery app:
60 failures → 40/40 suites, 609 tests, 0 failures. All fixed in the templates.

**Test harness (generated code, so generator bugs):**

- **`_by` foreign keys unresolvable** — `resolveParentEntity` derived the parent
  from `<stem>_id`, so `registered_by_id` looked for a `registered_by` entity and
  left a mandatory FK unset. Six entities could not be created at all.
- **`is_active` excluded as server-managed** — the generator never adds it; when a
  bus table has one the model declared it, often as required. The factory was
  forbidden from supplying a field the API demanded.
- **Name-driven fakers overrode the declared type** — `ratio` matched
  "calib(ratio)n", `login` matched "last_(login)". Patterns are now segment-
  anchored, and a value that does not fit the column's declared type is discarded.
- **Unique columns unique only within a run** — the salt came from the seeded
  faker, so a second run against a populated database regenerated a value it had
  already inserted (409). Now drawn from an unseeded per-process id.
- **`firstTextField` picked `email`** — suites write arbitrary markers into it,
  tripping the email-format rule. Format-constrained columns are now skipped.

**Rules engine (an app bug, not just a test bug):**

- **The CRUD verb was injected as `action`**, overwriting any entity column of
  that name. `bus_workflow_event.action` is a declared required column, so its
  required-field rule could never fire. The verb now travels as `_operation`.
- **Trigger-workflow rules tested an undeclared input (`i0`)**, so the condition
  was ignored and both post-create and post-update workflows fired on every
  operation. The decision table now declares the operation input.

**Audit report — server-side pagination**

The API was already paginated (LIMIT/OFFSET + total). The UI asked for a
hardcoded 50, computed page counts from that literal rather than the server's
echoed limit, and hid the pager below two pages. Now: 25/50/100/250 rows, row
range, first/previous/next/last, page maths from `meta`, and the previous page
held on screen while the next loads (without which the in-flight empty state
tripped the out-of-range clamp and bounced every navigation back to page 1).
Verified against 545 rows.

---

## Deferred by `/qa` on `claude/qa-gstack-generator-dance-studio-qr619s`, 2026-08-31

Found while QA-ing the CLI and a generated application against
`language/examples/dance-studio.eml.mmd`. Fourteen issues were fixed in the
generator on that branch; these eight were not. Full write-up, with evidence, in
`docs/qa/qa-report-dance-studio-2026-08-31.md`.

1. **~~`lint` writes, and the generated app does not pass it.~~** *Resolved by
   removal.* A generated application has no linter now: Biome, its config and its
   `lint`/`lint:fix`/`format` scripts are gone, and its static check is
   `"type-check": "bun check"` in both halves, which a freshly generated
   application passes — backend, frontend and `tests/`.

2. **A join entity's display value is two raw uuids.** *(medium)*
   §3.7 labels a join entity by its first two parents *resolved through their
   labels*, em-dash joined. The NestJS stack reads the referenced record's
   identifier columns without resolving them one level further, so
   `ClassSession` renders as `e70aa920-… · 04aa63ca-…`. The WASM runtime does
   this correctly; the two implementations have drifted.

3. **A list the caller may not read says "No records found".** — **RESOLVED (2026-09-19)**
   All three generated record shells now show an access-denied message on a
   failed 403 read, and a retryable error on other failures. They no longer
   render an empty grid or a create prompt for failed requests. Behavioral
   regression tests cover denial and retry in each shell.

4. **The §3.7 identifier ladder can pick an enum column.** *(low)*
   `ClassPack` has one FK and no name or code, so "first text column" selects the
   enum-bound `status` and every pack is labelled "active" or "exhausted".
   Skipping enum-bound columns in that step is the repair; it changes a ladder
   `scripts/check-spec.mjs` asserts, so it needs a spec change with it.

5. **`validate` warns on `*_by_id` and role-named foreign keys.** *(low)*
   Seven warnings each on `crm` and `drug-discovery` (`approved_by_id`,
   `owner_id`, `manager_id`, `pi_id`). `isForeignKeyColumnName` accepts `_by`
   and `resolveRefTableName` rejects it; reconcile the two, then decide what the
   validator should say.

6. **Sample bookings are internally implausible.** *(low)*
   `booked_at` and `cancelled_at` carry the same timestamp on every row, and
   `fee_waived` is true on a booking still `held`. The datetime and boolean cases
   of `business-data.ts.hbs` do not consult the column name the way strings and
   integers now do.

7. **The dictionary sync logs an error on every page.** *(low)*
   With `ELECTRIC_URL` unset — the documented default, where the frontend falls
   back to the HTTP API — `@tanstack/electric-db-collection` throws
   `TypeError: Failed to construct 'URL': Invalid URL` for `sys_window` and
   `sys_table`. The fallback works; the console does not say so.

8. **The Query devtools button overlaps "Add note".** *(low)*
   Dev-only, and its default corner is the corner the record screen puts a
   button in.

Also recorded, not a defect: `04-bulk-seed` times out at 60s on a 4-core
container while writing 1000 records across nine entities. It is the suite
`--run-tests-fast` skips.

## Found by /qa on `claude/shipping-management-qa-08b4e1`, 2026-10-30 — RESOLVED

Generated from `examples/shipping-management-system.eml.mmd` (NestJS + TanStack). All six
findings fixed on the branch, each with a regression test under
`packages/generator/src/templates/__tests__/` and rechecked in a regenerated app:

- **Reference dropdowns offered only the first 20 records** — `TableReferenceField` passed no
  `limit`; it now asks for `REFERENCE_LOOKUP_LIMIT` (500) like the other lookups.
- **Record navigator arrows squashed to 4px** — `Button` now merges a caller's classes over its
  variant's with `cn()`.
- **No navigation below `md`** — a header menu button opens the sidebar in the `MobileSidebar`
  drawer, which closes on navigation.
- **"Dangerous Goodses"** — one shared `lib/plural-label.ts` that leaves an already-plural label
  alone.
- **Toolbar buttons unnamed below `sm`** — `sr-only sm:not-sr-only` instead of `hidden sm:inline`.
- **React warning after a toast, every toast drawn twice** — two sonner Toasters were mounted; the
  one in `__root.tsx` is gone.

Not a defect: `Currency.decimal_places` accepts `-3` because the model declares no range for it.
