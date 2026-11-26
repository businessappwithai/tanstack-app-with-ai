# Business rules

A business rule is a **decision the application makes about a record every time
it is written** — "an invoice with money still owed cannot be cancelled",
"stamp the admission band from the applicant's attainment", "when an
application is accepted, start enrolment".

You write it as a **graph**, most often around a **decision table**: a few questions about the record on the
left, the answer on the right, one row per case. The generator compiles the
rule into a GoRules decision graph that the application evaluates inside the
write, so a rule that refuses a write really does stop it.

## The settings at the top

| Field        | What it means |
| ------------ | ------------- |
| **Name**     | What people call the rule. It is also how a process's *Look up a rule table* step names it, so it is saved as a short identifier — `Late Fee Guard` becomes `lateFeeGuard`. |
| **Entity**   | The record type the rule reads and writes. The input pickers below list this entity's fields. |
| **Priority** | Order among rules on the same entity. **Lower runs first** — run an early validation before a later transform. |

## When a rule runs, and what it can do

A rule has no "runs when" of its own. It runs when a **workflow** says so: open
the workflow on the Logic step, and under **Rules attached to this workflow**
attach the rule to one of the hooks the workflow listens on. The hook is the
moment. The moments a rule can be attached to are `beforeCreate`,
`afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete` and
`customValidate`. The generated application judges `beforeCreate` and
`afterCreate` the same way — it reads only *create*, *update*, *delete* or *any* —
so choose by what you mean, not by timing.

A rule written here and attached to no workflow keeps whatever moment it was
saved with, so a rule from an existing model carries on as before.

Here is what happens to one write, in order:

1. **Hooks** for that moment run first (a hook is code that prepares or checks
   the record — see the Lifecycle page).
2. **Your rules** run, lowest **Priority** first. A rule whose answer is
   `validation-error` stops the write here, and the user sees its message.
3. The record is saved.
4. The rules' other answers now take effect: `transform` changes the record,
   and `trigger-workflow` starts a process (see the Process page). Processes you
   set to start automatically start here too.

So a rule is how a hook or a process gets *decided*: the hook prepares the
record, the rule judges it, and the rule's answer can hand it on to a process.

## Using the editor

The rule is drawn as a **graph**, the way the GoRules editor draws it. Every
rule starts from the **Record** — the record being written — and ends at the
**Response**, which is the rule's answer. Between them you put the nodes that
work the answer out.

**Adding a node.** Open the **Components** panel at the right of the graph and
drag a node onto the canvas, then draw a line from the dot on one node to the
dot on the next.

| Node | Use it when |
| ---- | ----------- |
| **Decision table** | The cases are a list a person can read: *if status is cancelled and money is owed, refuse.* Rows of checks on the left, answers on the right. |
| **Expression** | One formula works out the answer: *refuse when the total is below the deposit.* Each line is a named value, e.g. `action = total < deposit ? "validation-error" : "allow"`. |
| **Function** | The logic needs loops, several steps or string work: a few lines of JavaScript, `export const handler = async (input) => ({ action: "allow" })`. It sees the record as `input` and may not use `import`, `require`, `fetch`, `eval` or `process`. |
| **Switch** | Different records need different handling: *large amounts go to review, small ones are approved.* A node that sends the record down the branch whose condition fits; each branch can lead to a table, an expression or a function. |

You can chain them: an expression can work out `owed`, a table can judge it, and
a switch can route the result.

**Whatever the last node produces is the rule's answer, and the application acts
on its `action`.** An answer with no `action` — say, only `total = 20` — does
nothing at all. This is the most common reason a first rule "does not work", and
**Try it** names it for you.

**Editing a node.** Click **Edit Table**, **Edit Expression** or **Edit
Function** on the node. It opens in its own tab beside **Graph**; close the tab
to go back. **Settings** on a node changes how it runs.

**Configuring the Record.** Click **Configure** on the **Record** node. Its
**Schema** tab lists the fields of the rule's entity, and nothing else — it is
written for you from the model, and it is what the editor checks every field
name against.

**Choosing inputs.** The editor's tab bar has **Inputs**, with a dropdown for
each input column of a table and **+ field…** to add one. They list the
entity's own fields only; there is no box to type a field name into.

**Choosing answers.** In a table's cells you pick, you do not type:

- a field that is an enum, or that a status machine drives, offers only the
  values the model allows — a **status** offers the states of that entity's
  status machine and no others;
- **Action** offers `validation-error`, `transform` and `allow`;
- **Field** (for `transform`) offers the entity's fields.

Anything the graph names that does not exist is listed in a box under the
editor, so a stray name is caught before the rule is saved.

**Developer and Business views.** The two buttons in the tab bar switch between
the editor with its formula boxes (**Developer**) and the editor with pick-lists
in the cells (**Business**). The pick-lists above need **Business**.

**Running it.** Press ▷ at the bottom-left of the graph to open the
**Simulator**: type a sample record, press **Run**, and read the answer under
**Output**.

**Linking it to a workflow.** A rule does not choose when it runs, and it cannot
start a workflow. Open the workflow and attach the rule to one of its hooks
under **Rules attached to this workflow**.

## How the table works

> Given **status** and **balance_due**, decide **Action** and **Message**

### Inputs — conditions on the entity's fields

In the editor's tab bar, choose **+ field…** under **Inputs** to add an input column. The dropdown lists every field on the selected entity and nothing else. Pick one — for example **status**. Each cell in that column is a check: pick a value for a status or an enum, type `> 0` to check a number, or leave it blank to match anything.

All checks in a row must fit for the row to apply. Rows are read **top to bottom** and the first row where every check fits is the answer — put the most specific case first.

### Outputs — what the rule does when a row fits

Click **＋** beside **Outputs** to add an outcome column. A dropdown lists the available output fields. The most common ones:

| Output field      | What it does |
| ----------------- | ------------ |
| **Action**        | `validation-error` blocks the write; `transform` changes a field; `allow` lets it through. A rule from an older model may still carry `trigger-workflow`, which starts a process — new rules do not offer it. |
| **Message**       | The sentence shown to the user when a `validation-error` fires. |
| **Workflow Name** | Only on an older rule that answers `trigger-workflow` — it offers just the processes defined for the entity. |
| **Field / Value** | For `transform` — which field to set and what value to write. |

A row where all checks are blank matches *everything*. Put it last as a catch-all default.

### Writing a check in a cell

| Type in the cell   | It fits when the field…              |
| ------------------ | ------------------------------------ |
| *(blank)*          | is anything at all                   |
| `"cancelled"`      | equals `cancelled`                   |
| `= 3` or `3`       | equals 3                             |
| `!= "paid"`        | is not `paid`                        |
| `> 0`, `>= 70`     | is greater than / at least the number |
| `< 70`, `<= 100`   | is less than / at most the number    |

Put text values in double quotes. Numbers are compared as numbers, so `> 0`
never fits an empty field.

### The outcomes

| Outcome           | Use it for |
| ----------------- | ---------- |
| **Action**        | What happens. `validation-error` refuses the write; `transform` changes a field on the record being written; `allow` lets it through. |
| **Message**       | The sentence the user sees when a `validation-error` refuses their write. Write it for them: *"An invoice with a balance cannot be cancelled."* |
| **Workflow Name** | On an older rule that answers `trigger-workflow`: the process to start, e.g. `AdmissionToEnrolment`. |
| **Field** / **Value** | For `transform`: the column to set and the value to put in it. |
| **Target Entity** / **Link Field** | For rules that reach a related record. |
| **Rule ID**       | An identifier for the row, shown in logs. Optional. |

## Moving, removing and adding rows

- **＋ Add row** adds a row at the bottom.
- **↑** / **↓** at the end of a row move it up or down. Remember the first
  fitting row wins, so moving a row changes the rule's meaning.
- **✕** removes the row.

## Try it before you save

Under the editor, **Try it before you save** takes a sample record (filled in
for you — change any value), runs the rule exactly as the application would, and
says in a sentence what would happen to the write: *Blocks the write*, *Starts
the workflow*, *Changes status on the record*, or *Lets the write through*. It
also says when the rule returned something the application cannot act on, such
as a missing `action` or a `trigger-workflow` with no **Workflow Name**. **How it
got there** lists what each node produced, in order. Nothing is saved.

### Testing a plain table

**Test with values** has a box for each input. Type a value the way a record
would hold it and the panel names the row that fits and the answer it gives.
If it says *"No row fits these values"*, the rule returns nothing for that
record. Usually that means a catch-all row is missing.

**Coverage check** warns about gaps: an input that reads no field, an outcome
with no name, or combinations of values that reach no row.

Rows compiled from `%%action` lines hold whole expressions such as
`has_sibling_enrolled == true`. The application evaluates those; the test panel
only understands the simple checks in the table above.

## Rules that came from the model

A rule written by hand in the `.mmd` opens in one of three ways:

1. **Written with `%%action` lines**, as most of the education model's rules
   are. It opens as the table those actions compile to. Editing it rewrites the
   `%%action` lines in place, and the flowchart drawn above them is kept.
2. **A table this editor wrote** (`%%decision-table`). It opens exactly as it
   was saved.
3. **Only a flowchart**, like *Admission Assessment*. Such a rule has no
   outputs: it documents a judgement and changes nothing. If the editor can read
   the flowchart as a table, it offers **Convert to a decision table**.
   Otherwise the flowchart is shown read-only and saved back untouched.
   **Start an empty table instead** throws the flowchart away, so use it only
   when you mean to re-enter the logic by hand.

## Show EML

**Show EML** shows the `%%rule` line and body this rule will be saved as, which
is exactly what goes into the model.

## Worked example — *Late Fee Guard*

1. Rules → **New**. Name it `Late Fee Guard`, Entity **FeeInvoice**, Priority `25`.
2. Under **Inputs** in the tab bar, choose **+ field…** and pick **status**, then
   again and pick **balance_due**.
3. Pick the outcome **Action**, then **＋** beside **Outputs** and pick **Message**.
4. **＋ Add row**. In row 1 choose `cancelled` under status and type `> 0` under
   balance_due, choose `validation-error`, and write the message.
5. Leave the last row blank. That is the *Otherwise* row, and it lets every
   other update through.
6. Under **Test with values** type `"cancelled"` and `50`. The panel should say
   **Row 1 fits**. Then **Save**.
