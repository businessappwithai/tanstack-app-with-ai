# 03 — validation log

Every step that touched the `.mmd` closed the same way (§10.0): edit → fixer →
checker → clean. One line per step, with the counts before and after.

> **Revision 1.1.0.** The table and the two sections after it are the log of the original
> nineteen-entity session and keep their original figures (19 entities, 11 machines, 68 `%%rbac`,
> 40 reports). The log for the current 25-entity model is the last section.

Engine: `bun language/checker.ts` from the checkout, which is
`language/checker.ts` itself — the same engine `appwithai.org/guide/checker.js`
is built from. The published runner and the site's scorer were then run over the
delivered bytes as an independent confirmation.

| # | Step | Before | Fixer changed | After |
|---|---|---|---|---|
| 1 | Phase 3 — seed: 19 entities, `id PK` only, categories, entity help, parents, 25 relationships | — | nothing to fix (no `.error` file yet; the fixer reads one, so the checker ran first) | **0 errors · 0 warnings · 25 info** — one `EML125` per relationship, exactly as §10.3 predicts, and **no `EML102`**, which is the diagnostic that would have meant an entity block the parser never read |
| 2 | Phase 4 structure pass — every column, its type, modifiers and `%%field help:`; 25 enum bindings; 14 indexes; 6 more relationships for the `_by_id` and one-off reference columns | 0e · 0w · 25i | nothing | **0 errors · 0 warnings · 0 info** — every `EML125` cleared by the foreign keys the walk added, and no `EML502`: every FK name resolves to a declared entity or is covered by a drawn edge |
| 3 | Phase 4 behaviour pass — 68 `%%rbac` directives merged first, ahead of the state machines they name transitions from | 0e · 0w | — | **15 errors**, all `EML214`: `%%rbac` naming a transition on an entity with no state machine yet. Expected of the ordering, and cleared by step 4 rather than by weakening the rules |
| 4 | Phase 4 behaviour pass — 10 rule sections, 11 state machines, 5 sagas, 19 hooks | 15e · 0w | — | **0 errors · 3 warnings**: `EML303`/`EML304` (a decision node with one outgoing edge, in the banding flowchart) and `EML500` (`StaffLifecycle` bound to an entity whose status column was called `employment_status`) |
| 5 | Repair of step 4's three warnings: the banding flowchart given real branches; `Staff.employment_status` renamed to `Staff.status`, with its help and enum binding moved with it | 0e · 3w | — | **0 errors · 0 warnings** |
| 6 | Phase 5 — the reporting pass: 40 `%%report` directives across eight roles | 0e · 0w | — | **0 errors · 0 warnings** |
| 7 | **Phase 7 delivery run over the exact delivered bytes** | — | `checkAndFix` reported `repaired: false` — there was nothing to repair | **0 errors · 0 warnings · 0 info** |

## The delivery run (§10.7)

Run against the published modules rather than the checkout, so the verdict is the
one a reader gets from `appwithai.org`:

```
$ node guide/check-model.mjs education-management-system.mmd
model    education-management-system.mmd
checker  guide/checker.js · EML 1.2.0
pass 1   checkAndFix 0e 0w 0i · repaired: false
pass 2   check       0e 0w 0i
pass 3   check       0e 0w 0i

OK — 0 errors, 0 warnings (EML 1.2.0)        exit 0
```

## The scorer (§10.6)

`scripts/check-model.mjs` audits the file contract and §10's checklist
mechanically — a different question from the checker's, and one a clean document
can still fail:

```
20 passed, 0 failed
```

including: every FK ends `_id` (32 of them), every reference column carries the
`FK` modifier, every status column is bound to an enum (12 of 12), 11 state
machines each with an initial transition and a terminal state, 31 `%%action`
directives, 5 sagas with 7 steps, 68 `%%rbac` directives, 19 `%%hook` directives,
and the repaired bytes being the delivered bytes.

## The two checks the checker cannot make (§10.6)

Both were run mechanically over the document, not by eye:

```
rules checked; off-row identifier count: 0
OK   saga writes FeeInvoice -> paid
OK   saga writes FeeInvoice -> part_paid
OK   saga writes Enrollment -> withdrawn
OK   saga writes Student    -> suspended
```

1. **Every identifier a `when:` reads is a column of the rule's own entity.** 31
   actions, 0 off-row identifiers. Three checks that could not be written this
   way were moved into handlers or onto columns instead — see
   `02-cross-cutting.md`.
2. **Every state a saga writes is a state its machine draws.** Two edges were
   added because this check asked for them: `part_paid → part_paid` and
   `on_leave → suspended`.

## What was *not* verified here

- **The report SQL against a live schema.** The checker has no database, so
  `EML290`–`EML296` validate the shape and nothing else. `check-reporting-pack.ts`
  in `app-and-report-with-ai-tanstack` executes every query against a real
  generated schema; it was not run in this session.

## Revision 1.1.0, then the four gaps closed — the current bytes

Five entities were added after the original session (`00-research.md` §10). Nothing below
reconstructs the steps that added them; it records what was run **over the file as it is**, with the
published modules (`guide/checker.js`, `guide/audit-model.mjs`, EML 1.2.0), so the verdict is the one a
reader gets from `appwithai.org`:

```
$ node guide/check-model.mjs education-management-system.mmd
pass 1   checkAndFix 0e 0w 0i · repaired: false
pass 2   check       0e 0w 0i
pass 3   check       0e 0w 0i

OK — 0 errors, 0 warnings (EML 1.2.0)        exit 0

$ node guide/audit-model.mjs education-management-system.mmd
23 passed, 0 failed
```

The audit reports, among its lines: 25 entities and 25 primary keys; 48 foreign keys, each ending
`_id` and each carrying `FK`; 17 status columns bound to enums (38 `%%field … enum:` bindings);
16 state machines, each with an initial transition and a terminal state; 63 sagas with 111 steps;
26 `%%hook` directives; help on 25 entities and 274 columns; every form laid out in `%%section` rows
(63 section lines); and 4 line items declared, none left on the dashboard.

Two of its figures are not the model's. The scorer counts every line that *contains* `%%rbac` or
`%%action`, and the file mentions each once or twice in comments, so it prints 96 and 44 where the
model has **94 `%%rbac`** and **43 `%%action`** directives — the figures the rest of these documents and
the website use.

The header comment of the `.mmd` itself was out of date in the delivered file (it still said nineteen
entities, five lifecycles and two sagas) and has been corrected to twenty-five, sixteen and seven.

### Still not verified here

- **The report SQL against a live schema** — by hand. CI does it (`02-cross-cutting.md`, "The reporting
  pass"); this session did not.
- **Anything that needs a running application.** The deployable archive for this model was generated in
  a browser and inspected (24 `bus_` tables at the time, 25 now, the model byte-identical inside, the reporting pack present),
  but `docker compose up --build` was not run on it.

### The four gaps closed

`progress.md` questions 6–8 and the refund approver were open; each is now in the model:

1. **`Student.has_support_plan`** is derived by `SupportPlanHooks` (true while a plan is `active` or `under_review`) and its help says so.
2. **A paid `Refund` moves its invoice.** `refundControl` starts `RefundReopensInvoice` or `RefundReissuesInvoice`, guarded by `applied_to_invoice_at == null` because the runtime does not de-duplicate a saga. Every state a saga writes is a state the invoice machine draws from every state the hook can leave it in: `paid → part_paid`, `paid → issued`, `part_paid → issued`, with `part_paid → part_paid` and `overdue → part_paid` already there. The hook leaves an overdue, draft or cancelled invoice alone.
3. **A reporting teacher hears the outcome** through the new `ConcernFeedback` entity, readable by `teacher`, written by the concern's hooks, holding no student.
4. **`refuseSelfApprovedRefund`** refuses an approver who is the requester.

The checker reports 0 errors, 0 warnings and the audit 23 passed, 0 failed on the new bytes. What a running application does with the two refund sagas, the seven hooks' handler bodies and `refuseSelfApprovedRefund` has **not** been exercised here: the handlers are stubs an author fills in, and no application was generated from this revision.
