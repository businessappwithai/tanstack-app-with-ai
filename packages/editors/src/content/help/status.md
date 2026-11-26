# Status state machines

A status state machine lists the **statuses a record can be in** and the
**moves allowed between them**. For example, an invoice goes `draft → issued →
paid`, or `issued → cancelled`, and nothing else.

**A record moves by its action buttons.** A save puts a record in **Draft** and
runs its rules and workflows; accepted, it moves to the status where records
start. From there, each arrow you draw is a **button** on the record's form —
labelled with the arrow's trigger — and pressing it moves the record along that
arrow. Where several arrows leave a status, the person chooses which. Every end
state is **Final**: the record is locked, and **Reopen** takes it back to Draft.

Nobody types a status: the form shows it read-only in its header beside the
buttons, the list always shows it as a column, and a write that changes it is
refused — administrators included. Even a workflow may only move along an arrow
you drew, and a `<status>_at` column, where the entity has one, is stamped when
the record reaches that status.

## Building one

1. Click **+ Status**.
2. Type a **Name**, e.g. `Invoice Lifecycle`, and choose the **Entity** whose
   status column it governs.
3. The canvas starts with one state, `draft`, marked as where records start.
4. **Add state** adds another. Click a state and rename it in the panel on
   the right. The name is the value stored in the status column, so use the
   same spelling as the entity's `%%enum`, e.g. `issued`, `part_paid`.
5. **Draw a move**: drag from the dot on the **right** of one state to the dot
   on the **left** of another. The arrow means *a record in this status may
   move to that one*.
6. Click an arrow to give it an optional **Trigger**, the name of the action
   that makes the move, e.g. `issue` or `cancel`. It becomes the arrow's label
   and the button's.
7. In the same panel, **Who may press it** names the roles whose button it is,
   separated by commas, e.g. `accounts, finance_manager`. Leave it empty and
   anyone who may edit the record can press it. A user holding several roles may
   press every move any of them is given.

## The state panel

| Control | What it does |
| ------- | ------------ |
| **Status value** | The value written to the status column. |
| **Records start here** | The status a new record gets. Exactly one state carries it. |
| **The process finishes here** | Marks an end state, such as `paid` or `cancelled`. At least one is required. The orange notice *"No finishing state"* disappears once one is marked. |
| **Trigger** (an arrow) | The move's name — the arrow's label and the button's. |
| **Who may press it** (an arrow) | The roles whose button it is, written as `%%rbac role:<roles> on <Entity>.<trigger>`. Empty: anyone who may edit the record. |
| **Delete state** / **Delete transition** | Removes the selected state, together with every arrow into and out of it, or removes the selected arrow. |

Use the **＋ / − / fit** controls in the corner of the canvas to zoom. Drag a
state to move it; its position has no effect on how the machine behaves.

## Good practice

- **Draw every real move, and only those.** If staff sometimes reopen a
  cancelled invoice, draw `cancelled → issued`. Otherwise that write is
  refused.
- **Match the enum.** A state whose name is not one of the column's enum
  values can never be reached by a real record.
- **Give every arrow its role.** Closing a deal, approving a quote, reopening a
  closed case — each is somebody's job. Name the role on the arrow; the checker
  lists the moves left open to anyone (`EML511`).
- **Let the buttons move the record.** A rule and saga that only write the
  status when a time is recorded would move it a second time; the checker
  reports them (`EML512`) and the fixer removes them.
- **Name the triggers.** A labelled arrow reads as a sentence in the generated
  screens (*"issue"*, *"cancel"*).

## Show EML

**Show EML** shows the `stateDiagram-v2` block that will be saved:

```
%%workflow InvoiceLifecycle entity: FeeInvoice kind: state
stateDiagram-v2
    [*] --> draft
    draft --> issued : issue
    issued --> paid
    paid --> [*]

    %%rbac role:accounts on FeeInvoice.issue
```

`[*] -->` marks where records start and `--> [*]` marks an end state. Each
`%%rbac` line gives a move to its roles; an arrow with no trigger is named
`from->to` (`issued->paid`).

## Buttons and what runs behind them

A record's buttons are named after the status they move to: an arrow
`draft --> to_be_reviewed : submit` gives a button called **To be reviewed**. The
word after the colon is still the move's name for `%%rbac` and the history.

Pressing a button saves the form first, then runs the workflows bound to the
status it moves to in a second transaction (see *Started by a hook and a status*
in the lifecycle and process help). The list **Runs when a state is entered**
under the diagram shows which workflows those are; you choose them on the
workflow, not here.
