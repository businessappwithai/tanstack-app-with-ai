# education-management-system — progress
Phase: 7 (delivered)  ·  Updated: 2026-10-24 — **revision 1.2.0** (25 entities); the 19 below are the original session

| Gate | State |
|---|---|
| A research    | approved (self-approved — no interactive user at the gate) |
| B roster      | approved (self-approved) |
| C entities    | 19 of 19 in the original session; 5 more added in revision 1.1.0 and `ConcernFeedback` after it (25 of 25, below) |
| D cross-cut   | approved |
| E validation  | clean — 0 errors · 0 warnings · 0 info, audit 23 passed 0 failed on the 1.1.0 bytes (`03-validation.md`) |

| Entity | State | Note |
|---|---|---|
| Department | approved | |
| Room | approved | |
| AcademicTerm | approved | |
| Staff | **amended** | `employment_status` renamed `status` so `StaffLifecycle` could bind (EML500) |
| Course | approved | |
| Guardian | approved | |
| Student | **amended** | gained the `on_leave → suspended` edge while walking DisciplineIncident |
| StudentGuardian | approved | |
| AdmissionApplication | approved | |
| ClassSection | approved | |
| ClassSession | approved | |
| Enrollment | approved | capacity check moved from a rule into `checkSectionCapacity` |
| AttendanceRecord | approved | no state machine, deliberately — see its dossier |
| Assessment | approved | |
| AssessmentResult | approved | gained `max_score`, copied from the paper |
| FeeInvoice | **amended** | gained `part_paid → part_paid` while walking Payment |
| FeeInvoiceLine | approved | |
| Payment | approved | gained `balance_before`, stamped before the write |
| DisciplineIncident | approved | |
| ConsentRecord | added in 1.1.0 | not walked through this session's gates; dossier generated from the model, judgement notes written from its help, rules and access |
| SupportPlan | added in 1.1.0 | as above; its hooks now keep `Student.has_support_plan` in step |
| SafeguardingConcern | added in 1.1.0 | as above; readable by `principal` and `counsellor` only, creatable by `teacher`, who hears the outcome through `ConcernFeedback` |
| ConcernFeedback | added after 1.1.0 | the outcome a reporting teacher can read; no student on it |
| CommunicationLog | added in 1.1.0 | as above; a record of messages, not a sender of them |
| Refund | added in 1.1.0 | as above; a paid refund now moves its invoice through two sagas, and an approver cannot be the requester |

**Completion mode: `DONE_WITH_CONCERNS`.** The document is clean and every gate is
closed, but the brief was one line and 22 statements in `00-research.md` §9 are
guesses that no user has confirmed. The one that would change roughly a third of
the roster is §1: this is modelled as a fee-charging secondary school rather than
a college or a training provider.

Open questions for the user, in the order they matter:

1. Is this a school, a college or a training provider? (research §1)
2. Are fees billed per term on enrolment, or on attendance? (research §1)
3. Should teachers record conduct incidents directly, or report them to the
   pastoral team? Today only `counsellor` and `principal` can read or write one.
4. Should a timetable clash and an over-capacity enrolment be **refused** as well
   as reported? Both are two-row facts, so refusing them means a handler.
5. Instalment plans are out of scope; they are real in most schools. (Refunds were out of scope
   when this list was written; revision 1.1.0 added `Refund`.)
6. ~~`Student.has_support_plan` says the plan is held outside this system~~ — **resolved**: derived
   from active and under-review plans by the `SupportPlan` hooks, help rewritten.
7. ~~Nothing moves a `FeeInvoice` when a `Refund` is paid~~ — **resolved**: two sagas, three new
   invoice edges, once only via `applied_to_invoice_at`.
8. ~~A reporting teacher cannot learn the outcome~~ — **resolved**: `ConcernFeedback`. Still open: a
   teacher can read every feedback row, not only their own, because `%%rbac` cannot scope rows.
9. ~~Nothing stops a refund being approved by its requester~~ — **resolved**: `refuseSelfApprovedRefund`.
