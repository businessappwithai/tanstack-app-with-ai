# Phase 5 — the cross-cutting pass

What no single entity owns, once every entity is in. §10.5.

> **Revision 1.1.0.** Counts below are for the model as it stands (25 entities). The original five sagas (the model now has seven; the two added turn a paid refund back into an open invoice), the
> three "not a rule" decisions and the sagas' state checks are as written in the original session; the
> access matrix, indexes, coverage sweep and reports have been brought up to date and say what changed.

## Multi-entity sagas

Five, each `kind: saga trigger: rule` so the rule's condition decides rather than
every write firing it.

| Saga | Triggered by | Steps | What compensates a failure |
|---|---|---|---|
| `AdmissionToEnrolment` | `enrolOnAcceptance` — `status == "accepted"` on `AdmissionApplication` | create `Student` → stamp `student_id` back on the application → create the term's `FeeInvoice` in `draft` | The invoice is created in `draft`, so a half-run leaves nothing billable. An application with `status = accepted` and a blank `student_id` is the visible failure, and `admissions-conversion-by-band` counts it as accepted, so the discrepancy surfaces. |
| `InvoiceSettlement` | `settleInvoice` — `amount >= balance_before` on `Payment` | move the invoice to `paid` | The payment stands and the invoice does not move; `finance-unapplied-payments` is the report that finds exactly that. |
| `PartPaymentPosting` | `postPartPayment` — `amount < balance_before` | move the invoice to `part_paid` | Same, and the same report. |
| `SectionCancellation` | `withdrawEnrolmentsOnCancellation` — `status == "cancelled"` on `ClassSection` | withdraw every enrolment on the section | An enrolment left `enrolled` on a cancelled section still shows in `registrar-section-fill`, and the student keeps a timetable slot that does not exist. |
| `SuspensionEscalation` | `suspendOnSuspension` — `sanction == "suspension"` on `DisciplineIncident` | suspend the student | A suspension recorded with the student still `enrolled` is visible in `counsellor-current-suspensions`, which lists suspended students and their incident and shows the mismatch as a missing row. |

**Every state a saga writes is a state its machine draws, from where the record
actually stands** — the §10.6 check, run mechanically over the document:

```
OK   saga writes FeeInvoice  -> paid        (issued → paid, part_paid → paid, overdue → paid)
OK   saga writes FeeInvoice  -> part_paid   (issued → part_paid, part_paid → part_paid, overdue → part_paid)
OK   saga writes Enrollment  -> withdrawn   (pending → withdrawn, enrolled → withdrawn)
OK   saga writes Student     -> suspended   (enrolled → suspended, on_leave → suspended)
```

Two edges exist only because this check asked for them, and both would have been
403s in a running application:

- `part_paid --> part_paid : record_further_part_payment` — a **second** partial
  payment. This is the transition §10.6 names as the one that is always
  forgotten, and the research called it out in §4 before any diagram was drawn.
- `on_leave --> suspended : suspend` — a serious incident concerning a student
  who is on leave. Without it `SuspensionEscalation` would fire, be refused, and
  leave the incident recording a sanction that never took effect.

A payment against a **draft** invoice is deliberately left with no edge:
`draft → paid` does not exist, so the guard refuses it. That is the correct
behaviour — an unissued invoice has not been sent to anybody — and it is written
down here so that the 403 is read as the model working rather than as a bug.

## What is *not* a rule, and why

Three checks that read like rules and are not, because a `when:` is evaluated
against the record being written and nothing else (§10.4). Each was written the
wrong way first and would have been seeded, drawn by the viewers, and inert:

| Check | Route taken |
|---|---|
| A section is full | **Route 2 — the whole check moved into the handler.** `checkSectionCapacity` on `beforeCreate` of `Enrollment` resolves the section and refuses. No action was left behind. |
| A payment exceeds what is owed | **Route 1 — made a column.** `resolveInvoiceBalance` stamps `Payment.balance_before`, which earns its place on a receipt independently, and `refuseOverpayment` reads it as an ordinary column. |
| A score exceeds the paper's maximum | **Route 1 — made a column.** `copyAssessmentMaximum` stamps `AssessmentResult.max_score`, which the invoice-line precedent already justifies: a paper rescaled next year must not rewrite marks already awarded. |

Three more are two-row facts with no honest column to hang them on, so they are
**reports rather than refusals**, and are named as such rather than promised:
a second primary contact per student, a timetable clash, and assessment weights
that do not total 100.

Two moves are the clock's and not a rule's: `mark_overdue` on an invoice, and an
admission offer expiring. Both are scheduled work; the model draws the edges and
the reports (`finance-overdue-invoices`, `admissions-offers-unanswered`) are what
a person acts from.

## The `%%rbac` matrix as a whole

Eight roles, 94 directives (68 before 1.1.0), and every entity carries a `read` line. Read counts —
the number of entities a role can see, which is the number of screens it signs in
to — are what the viewers' **Access** tab reports and what decides whether a role
is worth seeding at all:

| Role | Entities it can read | What it does |
|---|---|---|
| `principal` | 25 of 25 | Everything, including conduct and safeguarding. |
| `registrar` | 20 | Everything academic, invoices, consents, support plans and communications; not conduct, payments, refunds or safeguarding. |
| `finance_officer` | 13 | Money, refunds, the messages sent to families, and the people it is owed by. |
| `counsellor` | 15 | Pastoral: students, guardians, attendance, conduct, consents, support plans, safeguarding concerns and communications. |
| `teacher` | 15 | Their teaching surface: students, groups, sessions, registers, assessments, support plans and communications; may report a safeguarding concern. |
| `head_of_department` | 15 | The teaching surface plus the department's staff and courses, support plans and communications. |
| `admissions_officer` | 9 | Applications, applicants, guardians, terms, courses, staff, communications. |
| `guardian` | 14 | Their child's timetable, attendance, results and fees, plus consents, communications and refunds. |

No role reads 0 of 25, which is the failure §10.5 tells you to look for. Three
deliberate narrownesses are recorded rather than left to be discovered:

1. **`DisciplineIncident` is readable by `counsellor` and `principal` only.** A
   teacher therefore cannot record one — they report it to the pastoral team,
   who record it with the teacher named in `reported_by_id`. The alternative
   would have put every conduct record in front of every teacher, which research
   §7 rules out.
2. **`guardian` is a role, not a row filter.** `%%rbac` restricts by role and
   cannot scope a guardian to their own child; the four guardian reports are
   written for a portal that applies that filter. Stated in the research (§7) and
   again here, because a model that silently promised row-level scoping would be
   a safeguarding failure rather than a missing feature.
3. **`SafeguardingConcern` is readable by `principal` and `counsellor` only, and creatable by
   `teacher` as well.** A teacher can report a concern and cannot read it or its outcome back. Reporting
   has to be easy and reading narrow, but the model does not say how a reporting teacher learns that
   action was taken. Recorded here and in `progress.md` as an open question.

## Indexes

Nineteen — fourteen from the original session, each a column pair a declared flow actually filters by,
and five added in 1.1.0 — not a guess:

`Student(status, year_group)` · `Enrollment(class_section_id, status)` ·
`Enrollment(student_id, status)` · `ClassSession(starts_at, status)` ·
`ClassSection(academic_term_id, status)` · `AttendanceRecord(class_session_id, status)` ·
`AttendanceRecord(student_id, status)` · `AssessmentResult(assessment_id, status)` ·
`FeeInvoice(status, due_on)` · `FeeInvoice(student_id, academic_term_id)` ·
`Payment(fee_invoice_id, received_at)` · `AdmissionApplication(status, submitted_on)` ·
`DisciplineIncident(status, occurred_at)` · `StudentGuardian(student_id, contact_order)` ·
`ConsentRecord(student_id, consent_type, status)` · `SupportPlan(student_id, status, review_due_on)` ·
`SafeguardingConcern(status, reported_at)` · `CommunicationLog(guardian_id, status, sent_at)` ·
`Refund(payment_id, status, requested_at)`

Each of the first fourteen appears in the `WHERE` or `GROUP BY` of at least one report above, which is
the test §10.5 sets. The five added in 1.1.0 follow the same rule by construction but that cross-check
was **not repeated** for them.

## The coverage sweep

Run as a checklist, not a review:

- [x] every entity has `%%entity <Name> help:` — 25 of 25;
- [x] **every column** has `%%field <E>.<col> help:` — 223 of 223 non-key columns,
      verified by the dossier generator, which prints `**no help text**` where one
      is missing and printed none;
- [x] every child has a parent and a foreign key back to it — 4 children, no
      `EML148`;
- [x] every state in every `stateDiagram-v2` is backed by a declared `%%enum` —
      16 machines, no `EML426`/`EML428`;
- [x] every cross-entity effect from every dossier landed somewhere real — 5
      sagas, 26 hooks, and the three that deliberately did not are listed above;
- [x] every rule that must act is an `%%action`, not a node-graph — 15 rule
      sections, 14 of them decision tables; `admissionAssessment` is the one node
      graph and its dossier says in terms that it decides only;
- [x] nothing relies on a directive for behaviour its `status` does not support —
      `%%report` is validated here and compiled by the reporting pack, which is
      where the reports are used.

## The reporting pass

45 `%%report` directives across the eight roles (40 before 1.1.0), each answering one of §10.5.1's
four questions in that role's own terms:

| Role | Reports | The "that's wrong, fix it today" one |
|---|---|---|
| `principal` | 7 | `principal-teaching-cover-gap` — groups whose teacher has left; added in 1.1.0: `principal-untriaged-safeguarding` |
| `registrar` | 8 | `registrar-timetable-clashes` — a child booked into two rooms at once; added in 1.1.0: `registrar-consents-expiring`, `registrar-failed-communications` |
| `teacher` | 5 | `teacher-registers-not-taken` — a hole in the statutory return |
| `head_of_department` | 4 | `hod-weights-not-adding-up` — a grade that means nothing |
| `admissions_officer` | 4 | `admissions-offers-unanswered` — a place held for a family who has gone elsewhere |
| `finance_officer` | 8 | `finance-unapplied-payments` — money in the bank, family still on the chase list; added in 1.1.0: `finance-refunds-awaiting-decision` |
| `counsellor` | 5 | `counsellor-repeat-incidents` — a pattern rather than an incident; added in 1.1.0: `counsellor-support-reviews-due` |
| `guardian` | 4 | `guardian-outstanding-fees` — what is owed, without ringing the office |

None of them restates the derived baseline: no report here is a count of rows in
a table or a lifecycle the state machine already gives for free.

**The SQL has been run against a real schema, by CI and not by this session.** The checker validates
the shape (`EML290`–`EML296`) and has no database. `check-reporting-pack.ts` in
`app-and-report-with-ai-tanstack` executes every query of every `examples/*.eml.mmd` against a
generated schema, and its CI job ("Reporting pack against a real schema") was green on that
repository's pull requests that replaced this model with the 1.1.0 revision. The pack it derives is
189 queries, 165 reports and 118 charts. It was not run by hand in this session.

---

> **Gate D — cross-cutting approved**, merged, and put through the §10.0 loop:
> `0 errors · 0 warnings`. No `EML102` survives, so no entity went unwalked.
