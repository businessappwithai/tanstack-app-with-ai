# Lifecycle processes

A lifecycle process attaches **your own code** to fixed moments in a record's
life. Examples: *before an invoice is created*, *after a payment is updated*,
*before a student is deleted*. Each moment is one **lifecycle step**, and each
step names a **handler**, the function the generated backend calls at that
moment.

Use a lifecycle process when the work needs code a rule cannot express, such as
hashing a password, calling a library, or recalculating a total across related
rows. If a decision table can express it, prefer a **business rule**. If it is
a sequence of record changes, prefer a **process**.

## Building one

1. Click **+ Lifecycle**. A process called *Untitled process* opens with one
   empty step.
2. Click the title and type a name, e.g. `Fee Invoice Hooks`. The rail updates
   as you type.
3. On the right, choose the **Record type** every step runs on.
4. Click the step card to open it in the inspector and fill in the fields
   below.
5. Add more moments with **＋ Add a lifecycle step**, or the small **＋**
   between two cards to insert one there.

## The fields of a lifecycle step

| Field                | What to put in it |
| -------------------- | ----------------- |
| **When**             | The moment it runs. The hint under the handler explains each one. |
| **Handler**          | The function name, e.g. `recalculateBalance`. Letters, digits and underscores, not starting with a digit. Until you name it the card shows **(unnamed)** in orange and the step is reported as a problem. |
| **Field (optional)** | The column the handler is about, e.g. `issued_on` for a handler that stamps it. Leave it on *whole record* when the handler works on the record as a whole. |

**↑ Move up** / **↓ Move down** reorder the steps, and **Remove step** (or
the **✕** on the card) deletes one.

### Which moment to choose

| Moment | Typical use |
| ------ | ----------- |
| `beforeCreate` | Set defaults, normalise input, hash secrets |
| `afterCreate` | Send a notification, emit an event |
| `beforeUpdate` | Validate or transform before the change is saved |
| `afterUpdate` | Audit the change, invalidate a cache |
| `beforeDelete` | Refuse the delete while the record is still referenced |
| `afterDelete` | Clean up related rows or files |
| `beforeRead` / `afterRead` | Guard, redact or enrich a single record |
| `beforeQuery` / `afterQuery` | Scope a query (tenant filters), post-process rows |
| `beforeList` / `afterList` | Adjust filtering, sorting and paging of a list |
| `customValidate` | Cross-field or business validation on any write |

`before…` moments run inside the write and can stop it. `after…` moments run
once the change has been saved.

## Conditions and actions after the steps

**＋ Add a condition or an action** adds a check (*only carry on when…*) or a
step such as *Update a field* after the lifecycle steps. These are the same
steps a **process** offers, and its help page explains each one.

## What the generator does with it

Each step becomes a `%%hook <when> <handler> on <Entity>` line in the model.
The generator writes one handler module per entity, under
`backend/src/modules/hooks/handlers/<Entity>.ts`, with a stub for each handler,
and registers it for that moment. The stub is where your code goes.
**Regenerating never overwrites a handler you have written.** A handler added
later is appended to the module as a new stub.

## The orange notices

The line under the title (*"1 thing to fix before publishing"*) counts
problems, and each problem is repeated on the card it belongs to. The most
common is an unnamed handler. Every problem must be fixed before the process
compiles into working code.

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

Only before-update and after-update steps can be bound to a status, because a
move is an update.
