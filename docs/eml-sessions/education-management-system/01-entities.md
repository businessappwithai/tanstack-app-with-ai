# Education Management System — Phase 2 entity roster

Derived from the approved `00-research.md` under §10.2. **Nineteen entities at Gate B; revision
1.1.0 added five, and a later revision a twenty-fifth, `ConcernFeedback`** (the second table below, and `00-research.md` §10). The nineteen: the
artefacts and actors from the research, the reference entities the described
flow silently depends on (a room, a term, a department), and the one join
entity a many-to-many needs (`StudentGuardian`, which is a real object because
it carries custody and contact order).

**Placement** is decided here, not later, by §3.3.1's three questions, answered
in writing for every entity:

1. Would a list of these records, away from their owner, be useful to anyone?
2. Does the row's identity depend on the owner?
3. Would deleting the owner make the row meaningless?

*Any* yes to 2 or 3, or no to 1, is a child.

---

| # | Name | Role — and when a record comes into existence | Source (§ of research) | Placement | Category | Read roles (first draft) |
|---|---|---|---|---|---|---|
| 1 | `Department` | A teaching department that owns courses and employs teaching staff. Created once, when the school's structure is set up. | §2 head of department, §3 | standalone | Academics | registrar · head_of_department · principal · teacher |
| 2 | `Course` | A subject as it is offered and examined. Created when the curriculum for a year is agreed. | §3, §6 | standalone | Academics | everyone who teaches or enrols |
| 3 | `AcademicTerm` | A named teaching period inside an academic year. Created when the school calendar is published; every enrolment, invoice and result is bounded by one. | §6 | standalone | Academics | all staff roles · guardian |
| 4 | `Room` | A teaching space with a capacity. Reference data; created with the estate. | §3 section needs a room | standalone | Academics | registrar · principal · teacher |
| 5 | `Staff` | An employee — teaching or administrative. Created at appointment; never deleted, deactivated on leaving. **The model's person entity**: every `_by_id` column resolves here. | §2 | standalone | People | all staff roles |
| 6 | `Student` | The child. Created at *offer acceptance* (§4 of the research), never at enquiry, and never deleted — a leaver is a status. | §3, §4 | standalone | People | all staff roles · guardian |
| 7 | `Guardian` | The adult legally responsible for one or more students. Created when the first application naming them is accepted. | §3, §6 | standalone | People | admissions_officer · registrar · finance_officer · principal · counsellor |
| 8 | `StudentGuardian` | One guardian's relationship to one student: kind of relationship, contact order, whether they may collect. Created with the student and edited over the child's life. | §3, §7 duty of care | **child** — `parent: Student` | — | as `Student` |
| 9 | `AdmissionApplication` | A request for a place, with an outcome. Created when a family applies; terminal once accepted, declined, rejected or withdrawn. | §2, §3 | standalone | Admissions | admissions_officer · registrar · principal |
| 10 | `ClassSection` | One taught group of a course in one term — teacher, room, capacity, timetable slot. Created when the term is timetabled. | §3, §6 | standalone | Academics | all staff roles · guardian |
| 11 | `ClassSession` | One dated, timed meeting of a section. The register is taken against this and nothing else. Created in bulk when the section's timetable is generated. | §3, §6 | standalone | Academics | teacher · registrar · head_of_department · principal |
| 12 | `Enrollment` | One student's place in one section for one term. Created when the registrar places the student; terminal once completed, withdrawn or failed. | §3, §6 | standalone | Enrolment | all staff roles · guardian |
| 13 | `AttendanceRecord` | One student's mark for one session — present, late, absent, excused. Created when the teacher takes the register. | §3, §7 statutory return | **child** — `parent: ClassSession` | — | as `ClassSession` |
| 14 | `Assessment` | A marked piece of work set on a section: a maximum score, a weight and a due date. Created when the teacher sets it. | §3 | standalone | Assessment | teacher · head_of_department · registrar · principal · guardian |
| 15 | `AssessmentResult` | One student's mark for one assessment. Created when the assessment is published to the group; scored when marked. | §3 | **child** — `parent: Assessment` | — | as `Assessment` |
| 16 | `FeeInvoice` | What a student's guardians owe for one term. Created at the census date; terminal once paid or cancelled. | §1, §3 | standalone | Finance | finance_officer · principal · registrar · guardian |
| 17 | `FeeInvoiceLine` | One charge on an invoice — tuition, transport, examination entry, materials. | §1, §3 | **child** — `parent: FeeInvoice` | — | as `FeeInvoice` |
| 18 | `Payment` | Money received against an invoice. Recorded once, never edited; a correction is a second, offsetting record. | §3 | standalone | Finance | finance_officer · principal · guardian |
| 19 | `DisciplineIncident` | A recorded conduct event, its investigation and its outcome. Created when a member of staff reports it. | §3, §7 safeguarding | standalone | Conduct | counsellor · principal *(deliberately **not** every teacher)* |

## Revision 1.1.0 — five entities added

Not part of the Phase 2 roster above, and not walked through its gates. They were added to the
model later; each is **standalone** (none declares `parent:`), and each answers §3.3.1's Q1 *yes*:
there is a list someone opens away from any one student or payment.

| # | Name | Role — and when a record comes into existence | Placement | Category | Read roles |
|---|---|---|---|---|---|
| 20 | `ConsentRecord` | One guardian's time-bounded decision about a student's participation, information use or emergency treatment. Created when a consent is recorded; `withdrawn` keeps the earlier authority and when it ended. | standalone | Student Support | principal · registrar · counsellor · guardian |
| 21 | `SupportPlan` | The controlled summary of a student's learning, accessibility, medical or behaviour support, its owner and its review date. Created in `draft`, activated, reviewed, closed. | standalone | Student Support | principal · registrar · head_of_department · teacher · counsellor |
| 22 | `SafeguardingConcern` | A confidential welfare or child-protection concern in factual language, triaged to an accountable owner. Separate from discipline because the student may be at risk rather than at fault. | standalone | Student Support | principal · counsellor *(a teacher may **create** one and cannot read it)* |
| 23 | `CommunicationLog` | An auditable record of an operational message to a guardian about a student, including delivery failure — subject and outcome, not content. | standalone | Student Support | all eight roles |
| 25 | `ConcernFeedback` | What a staff member who reported a safeguarding concern is told about it afterwards: case reference, a neutral outcome and a short message, never the student. Written by the concern's hooks. | standalone | Student Support | principal · head_of_department · teacher · counsellor |
| 24 | `Refund` | A controlled reversal of money received, requested and approved by different staff where possible. Never edits or deletes the original `Payment`. | standalone | Finance | principal · finance_officer · guardian |

Relationships these add (11, taking the model from 31 to 42):

```
Student   ||--o{ ConsentRecord        has consent
Guardian  ||--o{ ConsentRecord        grants consent
Student   ||--o{ SupportPlan          supported by
Staff     ||--o{ SupportPlan          owns                  (support_plan.owner_id)
Student   ||--o{ SafeguardingConcern  protected by
Staff     ||--o{ SafeguardingConcern  reports and owns      (reported_by_id, owner_id)
Student   ||--o{ CommunicationLog     concerns
Guardian  ||--o{ CommunicationLog     receives
Staff     ||--o{ CommunicationLog     sends                 (sent_by_id)
Payment   ||--o{ Refund               reversed by
Staff     ||--o{ Refund               requests and approves (requested_by_id, approved_by_id)
```

`owner_id` is not a name the generator resolves on its own (there is no `Owner` entity); it is a
reference because the drawn `Staff ||--o{ …` edge covers it, which is the case the checker's
`EML502` allows. The `_by_id` columns resolve to `Staff`, the model's person entity, as before.

---

## The four placement decisions, answered

| Entity | Q1 useful away from owner? | Q2 identity depends on owner? | Q3 meaningless without owner? | Verdict |
|---|---|---|---|---|
| `StudentGuardian` | No — "all guardian links" is not a screen anyone opens; the safeguarding list is a report | Yes — it is *this* child's link to *this* adult | Yes | **child of `Student`** |
| `AttendanceRecord` | No — a mark away from its session is meaningless; the register is the screen | Yes — "the mark for session 7" | Yes | **child of `ClassSession`** |
| `AssessmentResult` | No — a score with no paper attached says nothing | Yes | Yes | **child of `Assessment`** |
| `FeeInvoiceLine` | No — the noun is the tell: a *line* | Yes — "line 2 of invoice 41" | Yes | **child of `FeeInvoice`** |

And the four that were argued and came out **standalone**, because getting these
wrong the other way puts a screen on the dashboard nobody opens — or takes one
away that everybody does:

| Entity | Why standalone |
|---|---|
| `ClassSession` | Q1 is emphatically yes: *today's sessions across every section* is the register screen and the timetable, the two most-opened lists in the application. A session is identified by its own date and time, not by "meeting 3 of section X", and a section is never deleted — it is cancelled. |
| `Enrollment` | The registrar's core working list is enrolments across sections ("who is unplaced", "who clashes"), not a tab on one section. |
| `Payment` | The daily takings list is payments across invoices. Its identity is the transaction, not the invoice. |
| `Assessment` | A teacher's "what have I got to mark" spans every section they teach. |

## Relationship sketch

Enough for the Phase 3 skeleton to be drawn. Cardinality, and which side carries
the foreign key (always the many side).

```
Department      ||--o{ Course             offers
Department      ||--o{ Staff              employs            (staff.department_id, optional for admin staff)
Course          ||--o{ ClassSection       taught as
AcademicTerm    ||--o{ ClassSection       scheduled in
Staff           ||--o{ ClassSection       teaches            (class_section.staff_id — *not* teacher_id, see below)
Room            ||--o{ ClassSection       hosts
ClassSection    ||--o{ ClassSession       meets as
ClassSection    ||--o{ Enrollment         enrols
ClassSection    ||--o{ Assessment         sets
Student         ||--o{ Enrollment         takes
Student         ||--o{ StudentGuardian    linked by
Guardian        ||--o{ StudentGuardian    linked by
Student         ||--o{ AttendanceRecord   marked in
ClassSession    ||--o{ AttendanceRecord   registers
Assessment      ||--o{ AssessmentResult   marked as
Student         ||--o{ AssessmentResult   scores
Student         ||--o{ AdmissionApplication  results from   (application.student_id, set at acceptance)
Guardian        ||--o{ AdmissionApplication  submitted by
Student         ||--o{ FeeInvoice         billed to
AcademicTerm    ||--o{ FeeInvoice         covers
FeeInvoice      ||--o{ FeeInvoiceLine     itemised as
FeeInvoice      ||--o{ Payment            settled by
Student         ||--o{ DisciplineIncident subject of
Staff           ||--o{ DisciplineIncident reported by       (incident.reported_by_id)
Staff           ||--o{ AttendanceRecord   marked by         (attendance.marked_by_id)
```

## Naming decisions that a reference suffix silently decides (§10.4)

The generator resolves a reference from the **column name alone**, and a name
that resolves to nothing is stored as a plain string — no lookup, no display
name, a raw uuid in every grid. Three names on this roster were nearly written
the wrong way:

| Nearly written | Written instead | Why |
|---|---|---|
| `teacher_id FK` on `ClassSection` | `staff_id FK` | `teacher_id` resolves to `bus_teacher`, which this model does not declare. The word *teacher* goes in the help text. |
| `head_teacher_id FK` on `Department` | `head_staff_id`… no — `staff_id FK` | same failure. One `staff_id` on `Department`, with "the head of department" in its help. |
| `reported_by_staff_id FK` | `reported_by_id FK` | the `_by_id` suffix resolves to the model's person entity, which is `Staff` here (`User` is not declared). `reported_by_staff_id` would resolve to `bus_reported_by_staff`. |

## Roles

Eight, from §2 of the research. Every role named here gets one seeded account in
the generated application, so this list is also the roster of demo logins — and
every role must end up with a `read` line and its own reports (§10.5.1).

`principal` · `registrar` · `admissions_officer` · `head_of_department` ·
`teacher` · `finance_officer` · `counsellor` · `guardian`

---

> **Gate B — roster approved** (the original nineteen; revision 1.1.0 later made it twenty-four and a further change twenty-five,
> still four children and eight roles). Nineteen entities, four of them children, eight
> roles. Self-approved by the running agent (no interactive user at the gate);
> the question that would have been put — *what does this school have that is
> not on here?* — is answered in the research's §8 out-of-scope list, and the
> roster is delivered with the model so a reader can still answer it.
>
> Walk order for Phase 4 (parents and referenced entities first):
> `Department → Room → AcademicTerm → Staff → Course → Guardian → Student →
> StudentGuardian → AdmissionApplication → ClassSection → ClassSession →
> Enrollment → AttendanceRecord → Assessment → AssessmentResult → FeeInvoice →
> FeeInvoiceLine → Payment → DisciplineIncident`.
>
> Pass shape (§10.4): **pass at a time** — structure for every entity, then
> behaviour, then reports. The domain is a familiar one and the whole shape is
> worth having visible before any behaviour is written on top of it.
