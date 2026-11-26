---
name: browser-rule-builder
description: Write a business rule in a generated application's rule editor (Admin → Business Rules → Create) using only the browser — drag Record, Expression, Decision table, Function, Switch and Response from Components, join them, type every cell — and test it only in the browser, with the Simulator, Try it, a save and a reopen. Use when asked to build, demonstrate or QA a business rule "through the editor", "in the browser", "without the API", or to test the rule editor itself.
---

# Business rules, built and tested in the browser

The rule editor is the GoRules canvas inside the generated application. Everything
here is done the way an author does it: pointer drags, clicks and typing. Nothing is
seeded through the API or the database, and every answer is read off the screen, or
off a reply the page itself received.

The worked example is **`scripts/e2e-rules-workflows/specs/11-generated-thirty-rule-flow.spec.ts`**:
thirty rules in one flow on Opportunity (6 expressions, an 8-row table, a 4-rule function,
a 4-branch switch, an 8-row verdict table), tested with 15 sample deals. Copy its shape.
`specs/10` is the small version (six nodes on Lead). The canvas helper is
`scripts/e2e-rules-workflows/lib/rule-graph.ts` (`RuleGraph`) — **read the
`rule-editor-e2e` skill too**; its list of canvas traps applies here unchanged.

## Before you start

- A generated application running — see `generate-and-run-app`. Front end on :4000,
  backend on :4001, signed in as `admin@admin.com` (the password the seed printed).
- Sign in at **`/auth/login`**, then wait for any URL that is not the sign-in page —
  some generated apps land on `/`, not `/dashboard`.
- Run a spec against it:

  ```bash
  cd scripts/e2e-rules-workflows
  E2E_NO_SERVER=1 E2E_BASE_URL=http://127.0.0.1:4000 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
    SHOTS_DIR=/path/for/screenshots bunx --bun playwright test -c playwright.config.ts specs/11
  ```

  A cold dev server compiles the first page for minutes: give `goto` and the sign-in
  wait 300 s, and set `test.setTimeout` generously (the 30-rule build takes ~4 min).

## Design the flow first

Write the rule down as a table before touching the canvas — node, its rules, what each
decides — and give every row a sample record that **only that row** explains. The test
is then "each sample gets the answer its row says", which proves the row, not just the
graph. A refusal must also name something only that path computed (a tier, a score),
so a sample cannot pass by luck.

- **The answer is an output named `action`**: `"validation-error"` refuses, `"allow"`
  lets it through, `"transform"` needs `transformData`. A `message` output beside it is
  what the person sees. Values with no `action` do nothing — a Switch branch straight to
  the Response is how "skip the review" is written.
- **Values flow forward**: an Expression's keys, a table's outputs and whatever a
  Function returns (`return { ...input, score }`) are readable by every later node.
- **Cells in a graph reach the engine as written** (zen syntax). Only
  `"validation-error"` is rewritten to the engine's `"prevent"`. So output cells may be
  expressions: `"Standard deal: tier " + tier + ", score " + string(score)`.
- Tables are first-hit: put the specific rows first and a blank catch-all last.

## Building it

1. **New rule**: `/admin/rules/new` → `Select entity...` → the entity → fill the name
   (`input[placeholder*='Validate Email']`) → `graph.waitReady()`.
2. **Nodes**: `graph.clear()`, then `graph.add(kind)` for **all** nodes first,
   `graph.fitView()`, and only then `graph.link(...)`. Linking while adding pans the
   canvas and the next node lands half off-screen, so its line misses. Names are
   `expression1`, `decisionTable1`, `decisionTable2`, `function1`, `switch1`, `response`.
   Pass `edgesAfter` to every `link` when you know the count.
3. **Developer view**: click `Developer` (top right of the editor). Every table cell and
   expression value is then plain text you type.
4. **Expression**: `Edit Expression` → per row: `Add row`, then the new
   `.expression-list-item`'s `.expression-list-item__key` and `__value`, `insertText` each.
5. **Decision table**: `Edit Table` → input column from
   `getByRole("group", { name: "Inputs of decisionTable1" }).getByLabel("Input field whole record")`
   — **scope it**: every table on the canvas renders one, so the bare label matches two.
   Pick a field for unary cells (`>= 500000`) or `Whole record (formula)` for whole-record
   checks (`isLate and isLarge`). Rename `output` through `.grl-field-edit` → `Update`;
   add a column with the header's `+` → type the field → `Create`. Add rows with
   `.grl-dt__add-row` until the count is right.
6. **Cells**: click the cell body (`x:60`), **press Ctrl/Cmd+A**, `insertText`, Escape. A
   new output cell starts as `""`; typing without selecting first gives
   `"""validation-error"`, which the editor flags as an unknown action.
7. **Function**: `Edit Function` → wait for Monaco → `graph.typeIntoCodeBox(source)`.
   Never type into Monaco (it closes brackets for you). Source must
   `export const handler = async (input) => { … }` and return the record it was given.
8. **Switch**: `Add Condition` N−1 times → the last statement is `Else` (no input), the
   rest are `If` / `Else If` with an input each (`input, textarea, .cm-content`). Each
   statement has its own right handle, in order: `graph.link("switch1", target, i, n)`.
   `fitView()` before linking — the node grows as conditions are added.

## Testing it — browser only

- **Simulator**: the ▷ at the foot of the editor's left rail —
  `click(canvas.x - 24, canvas.y + canvas.height - 24)` where `canvas` is the
  `.react-flow` box (not the editor's: a warnings panel below changes its height). Set
  the request with `typeIntoCodeBox`, `Run`. **Read the output from
  `graph.codeBoxes()`** — it is a code editor and `getByText` finds nothing in it.
  Assert every derived value, not just the answer.
- **Try it** (`getByLabel("Try the rule")`): fill `Sample`, click `Run the rule`, and
  **wait for the page's own POST reply** before reading — the panel keeps the previous
  answer until the new one arrives. Wordings:
  - refused → `Blocks the write` and the message on the panel;
  - an `allow` row → `Lets the write through` — **no message shown**, so read it from
    the reply the page received (`waitForResponse(...).text()`);
  - a branch with no `action` → `The rule returned values but no action, so the
    application does nothing with them` — that also means it goes through.
- **Save** (`Create Rule`, expect the POST to answer 201), see it in the list, then
  **reopen** `/admin/rules/<id>/edit` and check the node count and a table's rows.
- **Optionally, a real write**: open a record of the entity in the app, edit it so one
  refusing row applies, save, and see the message in the form. The rule is now live on
  that entity — deactivate it (`Deactivate rule` in the list) when the test is done.
- Collect page errors and any CDN request; both must be empty.

Screenshot after every step (`page.screenshot`, not `testInfo.attach` — attachments
are not written without the HTML reporter) and keep `video: "on"` so the run can be
shown.

## Known editor behaviour (not your test's fault)

- The yellow panel under the canvas lists names the model does not have. A name an
  **earlier** node produces — an Expression's key, an upstream table's output, a key a
  Function returns (`return { ...input, score }`, `input.score = …`) — counts as known
  (`derivedNamesBefore` in `rule-graph-constraints.ts`). A name only a *later* node
  produces is still flagged, as the engine would not have it either. Spec 11 asserts the
  panel stays empty.
- Both tables' `Inputs` pickers sit in the tab bar at once.
