# Education Management System — Phase 1 research

Written under `llmdetailed.txt` §10.1, before any entity was named.

**Brief as given:** *"an educational management system"* — one line, no further
detail. Every line below is tagged: `[stated]` the brief said it, `[inferred]` it
follows from what the brief said, `[assumed]` a real guess that could plausibly
be otherwise.

> **Revision 1.1.0.** This is the Phase 1 research for the original nineteen-entity model and is kept
> as written. The model has since grown to twenty-five entities; what changed, and which lines below
> it overtakes, is in **§10**. Lines this document now contradicts are marked *(superseded — §10)*.

**Tag counts: 1 stated · 46 inferred · 22 assumed.** A one-line brief produces
that histogram, and the histogram is itself the finding: almost everything here
is the analyst's fill, so the `[assumed]` lines are the ones that decide whether
this is the right institution. They are listed together in §9 for that reason.

---

## 1. What the business does, and who pays for it

A fee-charging school teaching students from year 7 to year 13 on one campus.
[assumed — the brief does not say school, college or training provider; a school
is the shape that carries every mechanism the others need — admissions,
timetabling, attendance, assessment, fees and conduct — so a college or a
training provider is a narrowing of this model rather than a different one.]

It sells **a place in a year group for an academic term**, and the money arrives
as termly fees invoiced to a student's guardians, plus per-item charges for
transport, examination entry and materials. [inferred] The transaction that makes
money is therefore not the lesson but the *enrolment*: a student enrolled at the
census date is billed for the whole term whether or not they attend.
[assumed — the alternative, billing on attendance, exists in some tutoring
businesses and would change the invoice model.]

Two obligations sit alongside the commercial one and are the reason a school
needs software rather than a spreadsheet: a **statutory attendance return**, and
a **duty of care** that requires the institution to know at any moment which
adult is responsible for each child and who may collect them. [inferred]

## 2. The actors, and what each is trying to finish

| Actor | What they are trying to *finish* |
|---|---|
| Admissions officer | Turn an enquiry into an accepted, fee-liable student before the intake closes. [inferred] |
| Registrar | Have every enrolled student sitting in a class section that exists, is not over capacity, and does not clash with another the same student is in. [inferred] |
| Teacher | Get through today's register, mark this week's work, and record the two students who were not there. [inferred] |
| Head of department | Know that every section in their department has a teacher, a room and a marked assessment trail — before the head teacher asks. [assumed — that a department layer exists at all; a small school may have none.] |
| Principal / head teacher | Answer, on one screen, whether the school is full, whether attendance is above the statutory floor, and what is unresolved in conduct and money. [inferred] |
| Finance officer | Close the term with every invoice either settled or on a named plan, and know today which are overdue. [inferred] |
| Counsellor / pastoral lead | Close a discipline incident with a recorded outcome, and see the pattern of incidents before it becomes an exclusion. [inferred] |
| Guardian | Find out how their child is doing, what is owed, and what was missed — without phoning the office. [inferred] |

A receptionist and a nurse also touch a real school. Both are **out of scope**
(§8).

## 3. The artefacts that change hands

The school's own names, used verbatim as entity names wherever they are nouns
the staff already say. [inferred]

- the **application** — a request for a place, with an outcome; [inferred]
- the **student record** — the child, and everything hung off them; [inferred]
- the **guardian**, and the *relationship* between guardian and student, which is
  itself an artefact because it carries custody and contact order; [inferred]
- the **course** (the school says *subject*: Mathematics, Physics) and the
  **class section** — one taught group of that course in one term, with one
  teacher, one room and a capacity; [inferred]
- the **class session** — one dated meeting of a section: the thing a register is
  taken against; [inferred]
- the **enrolment** — one student's place in one section, for one term; [inferred]
- the **register** entry (attendance record) — one student, one session, one
  mark; [inferred]
- the **assessment** (a test, an essay, a mock exam) and its **result** per
  student; [inferred]
- the **fee invoice** and its **lines**, and the **payment** against it; [inferred]
- the **incident** — a conduct event, its investigation and its outcome. [inferred]

## 4. The lifecycle of the central artefact

The central artefact is the **student**, and everything else in the model is a
consequence of where the student stands. [inferred]

```
applicant → offered → enrolled → (on_leave ⇄ enrolled) → graduated
                          ↓                                  ↑
                      suspended ────────────────────────────┘
                          ↓
                      withdrawn
```

- An **applicant** exists from the moment an application is submitted; the
  student record is created *at offer acceptance*, not at application, so
  rejected applicants never become student records. [assumed — some schools
  create the record at enquiry.]
- **on_leave** covers a term abroad or extended illness; the place is held and
  the fee position is decided case by case. [assumed]
- **suspended** is a conduct outcome; the student stays enrolled and fee-liable
  and is barred from sessions. [inferred]
- **withdrawn** and **graduated** are both terminal, and the difference matters
  to every report about outcomes. [inferred]

The second lifecycle that carries the money — the **fee invoice** — runs
`draft → issued → part_paid → paid`, with `overdue` reachable from `issued` and
`part_paid`, and `cancelled` from `draft` and `issued`. [inferred] A *second*
partial payment must be able to leave the invoice in `part_paid`, so that state
needs an edge back to itself; this is the transition that is nearly always
forgotten and it is named here to make sure it is drawn. [inferred]

## 5. The decisions someone makes with judgement today

Each of these is a candidate rule, and the question that decides its shape is
whether it merely *decides* or must also *act*:

1. **Whether an application is worth an offer.** Prior attainment, the reference,
   the interview note and whether a sibling is already enrolled. Today a human
   weighs them. This *decides only* — it produces a band, and the offer is still
   a person's decision. [assumed — that sibling priority applies at all.]
2. **Whether a student may join a section.** Capacity, the student's own status,
   and whether the term is still open for changes. This must *act*: it refuses
   the write. [inferred]
3. **Whether a mark may be recorded.** A score above the assessment's maximum is
   a keying error, always. Must act. [inferred]
4. **Whether a payment may be accepted.** More than the invoice still owes is
   either a keying error or a credit that needs a decision. Must act. [inferred]
5. **Whether an absence is authorised.** An authorised absence needs a reason on
   the record, because the statutory return is built from exactly that
   distinction. Must act. [inferred]
6. **Whether a discipline outcome may be closed.** Closing without a recorded
   sanction is how an incident disappears. Must act. [inferred]
7. **Whether a withdrawal is allowed to leave no reason behind.** It is not; the
   reason drives the retention reporting. Must act. [inferred]

## 6. The vocabulary — what these words mean *here*

| Word | Meaning in this institution |
|---|---|
| **Course** | The subject as it is offered and examined — "Mathematics (Higher)". Not one lesson, and not one taught group. [inferred] |
| **Section** | One taught group of a course in one term: a teacher, a room, a timetable slot and a capacity. The thing a student is enrolled in. [inferred] |
| **Session** | One dated, timed meeting of a section. The register is taken against this and nothing else. [inferred] |
| **Term** | A named teaching period inside an academic year — "Autumn 2026". Fees, enrolments and results are all bounded by it. [inferred] |
| **Enrolment** | A student's place in a section. Not "registration", which staff here use for the daily register. [assumed] |
| **Register / attendance mark** | One student's presence at one session: present, absent, late or excused. [inferred] |
| **Assessment** | Any marked piece of work with a maximum score and a weight — a quiz, an essay, a mock exam. [inferred] |
| **Guardian** | The adult legally responsible. Not "parent": step-parents, carers and local authorities all appear here, and only one of them may be the primary contact. [inferred] |
| **Incident** | A recorded conduct event. The school never calls the outcome a "punishment"; the field is *sanction*. [assumed] |

## 7. Policy and regulatory constraints

- **Attendance is a statutory return.** Every session mark must distinguish
  authorised from unauthorised absence, and marks are retained for the whole of a
  student's time plus the statutory period afterwards. Nothing in the attendance
  trail may be hard-deleted. [inferred]
- **Safeguarding.** *(Extended by `SafeguardingConcern` in 1.1.0 — §10.)* Discipline incidents and pastoral notes are readable by the
  counsellor, the principal and nobody else by default — explicitly *not* by
  every teacher, and never by a guardian. This is the one place where the read
  matrix is a policy statement rather than a convenience. [inferred]
- **A guardian may see their own child's records and no others.** The role
  exists; row-level scoping to the child is enforced in the application, not by
  the role. Stated here so the limitation is on the record. [inferred]
- **Financial segregation of duties.** The person who raises an invoice and the
  person who cancels one are not the same person; cancellation is the principal's
  or the finance officer's, never a registrar's. [assumed]
- **Retention.** Student records survive withdrawal — the alumni and safeguarding
  obligations both need them — so a leaver is a status, never a delete. [inferred]

## 8. Explicitly out of scope

Named so the roster cannot grow by a third at Gate B:

- payroll, HR contracts and staff absence; [assumed]
- library circulation, transport routing and catering; [assumed]
- the medical/nursing record itself — its consent regime is partly in scope since 1.1.0:
  `ConsentRecord` holds a guardian's consent to medical treatment, the record does not
  *(superseded in part — §10)*; [assumed]
- learning content, submissions and plagiarism checking — this system records the
  *mark*, not the work; [inferred]
- the public examination board interface (entries are a fee line here, nothing
  more); [assumed]
- sending messages and the guardian mobile app — a log of what was sent is in scope since 1.1.0
  as `CommunicationLog`, a record and not a sender *(superseded in part — §10)*; [assumed]
- multi-campus and multi-tenant operation: one school, one campus. [assumed]

## 9. Every `[assumed]` line, gathered

These are the guesses. Each is cheap to change here and expensive to change after
Gate B.

1. The institution is a fee-charging secondary school, one campus. (§1)
2. Fees are billed per term on enrolment, not on attendance. (§1)
3. A department layer exists, with a head who has a real read/approve interest. (§2)
4. Student records are created at offer acceptance, not at enquiry. (§4)
5. `on_leave` is a real state the school uses. (§4)
6. Sibling priority is a factor in the admission decision. (§5)
7. "Enrolment", "sanction" and "guardian" are the words this school uses. (§6)
8. Invoice cancellation is segregated from invoice creation. (§7)
9. Everything in §8 is out of scope.
10. The academic year is represented by the term's own dates and label rather
    than as an entity of its own — a term carries `academic_year` as a label, so
    a year is a grouping in reporting rather than a table.

---

> **Gate A — research approved.**
>
> Summary put to the approver: *the brief was one line, so 46 statements are
> inferred and 22 are guesses. The six that decide the shape of the model are:
> it is a fee-charging secondary school; the money is termly fees against an
> enrolment; a student record starts at offer acceptance; a department layer
> exists; conduct records are restricted to pastoral staff; and the academic year
> is a label on a term rather than a table of its own.*
>
> **Approval:** self-approved by the running agent — this session has no
> interactive user at the gate. Every assumption above is listed in §9 and
> re-stated in the delivery note, and the fork in §1 (school vs college vs
> training provider) is recorded as the one that would change roughly a third of
> the roster. Completion mode is therefore `DONE_WITH_CONCERNS` (§10.0) unless a
> reader confirms §9.

---

## 10. Revisions 1.1.0 and 1.2.0 — what the model added, and what that supersedes

The model now has **25 entities, 16 state machines, 31 rules, 63 sagas, 26 hooks, 8 declared roles,
71 access restrictions and 45 `%%report` directives** (it had 19, 11, 10, 5, 19, 8, 68 and 40).
The state rule accounts for most of the growth: no person changes a status, so every move a lifecycle
draws is made by a saga a rule starts when the fact behind it is recorded — 56 move sagas, one
`<entity>StateProgress` rule per lifecycle, and the 23 `%%rbac` lines that granted a transition to a
role removed, because there is no longer a transition to grant.
Revision 1.1.0 added the five entities below; the later change closed the four gaps it had left open
(`progress.md` questions 6–8, and the refund approver): `ConcernFeedback` is the 25th entity, two
refund sagas and seven hooks were added, the invoice machine gained three edges, and `refundControl`
gained three actions.
The first nineteen entities are unchanged. Five were added, each from a duty §7 already names but
the original roster did not model:

| Added | Why the school needs it | Supersedes |
|---|---|---|
| `ConsentRecord` | A guardian's decision about a trip, a photograph, a data share or emergency treatment has a start, an end and an author; "we had consent" must be answerable on a date. | §8 "the medical/nursing record, which carries its own consent regime" — the *record* stays out, the *consent* is in |
| `SupportPlan` | Learning, accessibility, medical and behaviour adjustments need an owner and a review date, and teachers need the adjustments without the evidence behind them. | The `Student.has_support_plan` flag, which is now derived from the plans and no longer says the plan is held outside this system |
| `SafeguardingConcern` | §7 says safeguarding is the one place the read matrix is policy. Concerns are about a child at risk, not a child at fault, so they are not a kind of `DisciplineIncident`. | §7: pastoral notes are no longer only the discipline record |
| `CommunicationLog` | An auditable record that a guardian was told, and that delivery failed when it did. | §8 "messaging" — the sending stays out, the record is in |
| `Refund` | Money going back needs a request, a decision by someone else and a settlement date, without editing the original payment. | The progress note that refunds were out of scope |

Nothing here was approved at Gate A: these are the model's own later scope, recorded so the rest of
this document is not read as describing a model that no longer exists. The `[assumed]` list in §9 is
unchanged and still applies to the original nineteen; the five additions carry assumptions of their
own that nobody has confirmed — chiefly that a teacher may *create* a safeguarding concern but not read
it back (they hear the outcome through `ConcernFeedback`), that refunds are approved only by the principal, and that a guardian may read their own
consents, refunds and communications as a role, not as a row filter.
