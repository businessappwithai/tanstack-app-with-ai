# Processes

A process is a **sequence of steps the application carries out in order**. For
example: check the invoice is overdue, look up the late-fee rule, add the fee,
update the invoice, tell the finance system. It reads like a ladder, from
*When this happens* at the top to the last step at the bottom.

Use a process when one decision leads to **several changes**, possibly to
**other records**, possibly to **another system**. A single refusal or a single
field stamp is a business rule. A status move is a status machine.

## Building one

1. Click **+ Process**. A process called *Untitled process* opens.
2. Click the title and type a name, e.g. `Overdue Invoice Chase`.
3. On the right, choose the **Record type** the process runs on and **What
   starts it** (see below).
4. Click **＋ Add a condition or an action** and pick a step type. The small
   **＋** between two cards inserts a step at that point.
5. Click any card to edit it in the inspector on the right. **✕** on a card
   removes it.

## What starts it

| Choice | When the process runs |
| ------ | --------------------- |
| **A business rule decides** | Only when a rule row with the action `trigger-workflow` names this process in **Workflow Name**. The rule decides *whether*; the process says *what then*. |
| **The record's own lifecycle** | Every time a record of this type is written. Pick the operation (**CREATE**, **UPDATE**, …) that starts it. |

## The step types

Each step can **save its answer** under a name (the *Save the answer as* box),
and every later step can use that answer by writing `{{name}}`, or
`{{name.field}}` for one field of it. Fields of the record the process runs on
are available the same way, e.g. `{{feeinvoice.balance_due}}`. Boxes that
accept a reference suggest the values available at that point in the ladder.

### ◇ A check — *only continue if*

The steps below it run only when the check holds.

| Field | Example |
| ----- | ------- |
| **Field to look at** | `feeinvoice.balance_due` |
| **Test** | *is*, *is not*, *is greater than*, *is greater than or equal to*, *is less than*, *is less than or equal to*, *contains*, *starts with*, *is empty*, *is not empty*, *changed* |
| **Value** | `0`. Hidden for *is empty*, *is not empty* and *changed*, which compare against nothing. |

### ↻ A repeat — *keep repeating while*

Runs the steps inside it again and again **while** its check holds. The check
is re-read before every pass, so a step inside the repeat must change something
that eventually makes it false.

| Field | Meaning |
| ----- | ------- |
| **Field to look at** / **Keep going while** / **Value** | The check, as above. |
| **Give up after (required)** | A safety limit on the number of passes, e.g. `10`. Reaching it means the repeat never ended on its own, so the run is marked **failed** rather than finishing quietly. Every repeat must state one. |

A new repeat starts with one empty step inside it. Use **＋ Add a step inside
this repeat** for more. Repeats do not nest.

### ▤ Look up a rule table

Asks one of this model's **business rules** for an answer.

| Field | Meaning |
| ----- | ------- |
| **Rule table** | Any rule on this screen, by its identifier, e.g. `lateFeeGuard`. **Open table →** jumps to it. |
| **Save the answer as** | Defaults to `decision`. Later steps read `{{decision.action}}`, `{{decision.message}}`, and so on, one per outcome column. |

### ✚ Create a record

| Field | Meaning |
| ----- | ------- |
| **Record type** | What to insert, e.g. `DisciplineIncident`. |
| **Columns to set** | One `column: value` per line. A value is text, a number, `true`/`false`, or a reference such as `{{student_id}}`. |
| **Save the answer as** | Defaults to `createdId`: the new row's id, for a later step to update or delete it. |

```
status: reported
student_id: {{student_id}}
severity: 2
```

The lines are saved as the JSON map the generated application reads. A
map already written as JSON in the model opens as lines.

### ✎ Update a field

| Field | Meaning |
| ----- | ------- |
| **Record type** | The record to change. It shows the process's own record type until you pick another. |
| **Which record** | Only for another record type: a reference such as `{{invoiceId}}` published by an earlier step, or the column on that record that points back to this one, such as `order_id` (which updates every row it links). Leave it empty to write this record. |
| **Field to write** | Picked from that record type's columns. |
| **New value** | A fixed value (`overdue`) or a reference (`{{newBalance}}`). |

Writing another record type without saying which row is reported as a problem
(*"Step 4 writes a FeeInvoiceLine but does not say which one"*). The application refuses to
guess a row, so the step would otherwise never run.

### ✕ Delete a record

| Field | Meaning |
| ----- | ------- |
| **Record type** | What to delete. |
| **Which record** | Usually a reference from an earlier step, e.g. `{{incidentId}}`. |

Deletes are **soft** by default: the row is stamped as deleted, so the audit
trail can still reach it.

### ƒ Work out a value

| Field | Meaning |
| ----- | ------- |
| **Operation** | `set`, `copy`, `add`, `subtract`, `multiply`, `divide` |
| **Value to work from** / **And this value** | The two operands, e.g. `{{feeinvoice.balance_due}}` and `25` |
| **Save the answer as** | Defaults to `value`, e.g. rename it `newBalance` and write it back with *Update a field*. |

### ↗ Call a web service

| Field | Meaning |
| ----- | ------- |
| **Method** | `POST`, `PUT`, `PATCH`, `GET` or `DELETE` |
| **URL** | The endpoint, e.g. `https://example.com/hooks/overdue` |
| **Body** | JSON. References like `{{feeinvoice.id}}` are filled in before sending. You may lay it out over several lines; it is saved on one. |
| **Save the answer as** | Defaults to `response`, the reply, for later steps. |

## The orange notices

The line under the title counts the problems, and each card repeats its own:
*"Step 2 is missing a rule table to look up"*, *"Add at least one thing for
this to do"*. A process with problems still saves, so you can finish it later,
but it does not do what it says until they are fixed.

## Worked example: *Overdue Invoice Chase*

1. **+ Process**, name it, Record type **FeeInvoice**, starts from **The
   record's own lifecycle** on **UPDATE**.
2. **A check**: `feeinvoice.balance_due` *is greater than* `0`.
3. **Look up a rule table**: `lateFeeGuard`, saved as `decision`.
4. **Work out a value**: *add* `{{feeinvoice.balance_due}}` and `25`, saved as
   `newBalance`.
5. **Update a field**: FeeInvoice · `balance_due` · `{{newBalance}}`.
6. **Call a web service**: `POST` to your finance system with
   `{"invoice":"{{feeinvoice.id}}"}`.
7. **Save**.

## Started by a hook and a status

A workflow can be started by a hook **and a status together**. Under
**When the status becomes**, choose the state of the record's status flow the
workflow is for; with none chosen it runs on every update, as before.

A button press is then **two transactions**. The first saves the form, with the
record still in its current status. The second runs the workflows bound to the
status the button moves to, and moves the record only if every one succeeds. If a
step fails, the second transaction is undone: what you typed stays saved, the
status does not move, and the reason is shown on the record and in Run History.
Press the button again once it is fixed.

A record type with no status flow has two statuses, Draft and Final, so there is
nothing to choose: the picker shows **Final** and is disabled. Its button saves
the record; another transaction then runs the workflow and moves it to Final.

A process bound to a status starts on **Updated** with its lifecycle trigger.
