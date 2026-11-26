# Rules and processes

This step describes what your application **decides** and what it **does**
about those decisions. Everything you build here is written into the model
(`.mmd`) when you press **Save**, and the generator turns it into code the
application runs on every write.

There are four things you can make. Pick by the question you are answering:

| You want to…                                                        | Make a…            | Button        |
| ------------------------------------------------------------------- | ------------------ | ------------- |
| Refuse a bad write, fill in a value, or start a process — decided from the record's own fields | **Business rule**  | Rules → **New** |
| Run your own code at a fixed point in a record's life (before it is created, after it is deleted…) | **Lifecycle** process | **+ Lifecycle** |
| Say which statuses a record may move between, and which moves exist | **Status** machine | **+ Status**  |
| Carry out several steps in order — check, look something up, create, update, call out | **Process** (saga) | **+ Process** |

## How they fit together

A rule *decides*; a process *acts on the decision*.

- A rule row whose action is **trigger-workflow** starts a process by name.
- A process step of type **Look up a rule table** asks a rule for an answer
  and uses it in the steps after it.
- A status machine is checked on every write that changes the status column —
  a move the diagram never drew is refused, for every user, administrators
  included.

Because rules and processes live on one screen, one **Save** writes both into
the model in a single edit.

## The rail on the left

- Each item shows its **name**, the **entity** it runs on and **when** it runs
  (for a rule) or its **kind** (for a process).
- Hover an item to show its **delete** icon. Deleting takes effect on the next
  **Save**; until then a reload brings it back.
- The editor on the right always edits the item highlighted in the rail.

## Saving

Nothing is written until you press **Save** (or **Continue to generate**, which
saves first). "Saved to the model at …" under the editor confirms the write.
An error from the server appears in red above the editor and nothing is lost —
fix what it names and save again.

## Where the model came from

Rules and processes that were written by hand in the `.mmd` — or by a language
model following the EML specification — open here too. A few shapes cannot be
edited as a table or a ladder; the editor says so, shows the original, and
saves it back untouched. See the page for each editor for the details.
