---
name: rule-editor-e2e
description: Run and extend the Playwright end-to-end specs for the rule and workflow editors (scripts/e2e-rules-workflows, specs 07 and 09) against a running modelling tool, and drive the GoRules canvas with the RuleGraph helper. Use when writing or debugging those tests, or when asked for a QA pass on the rule editor.
---

# Rule editor E2E

## Run

With the tool already running (see `run-modelling-tool`; start it with the raised auth limits):

```bash
cd scripts/e2e-rules-workflows
E2E_NO_SERVER=1 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  bunx --bun playwright test -c playwright.config.ts specs/07 specs/09
```

`bun run test:e2e:rules-workflows` starts the server itself and needs `DATABASE_URL`. Spec 08 needs `-- --generated`. A failure leaves `test-results/*/test-failed-1.png` — **look at it**; it is usually the answer. Debug by writing a page screenshot to `/var/tmp`, not `testInfo.attach` (attachments are not written to disk without the HTML reporter).

## What the specs hold

- **07** — no "Runs when" on the Enhance rule editor; the dry-run route (`/rules/dry-run`): 401 anonymous, ≥403 stranger, answers the owner, runs a real graph, refuses a function that uses `fetch`.
- **09** — the walkthrough: new rule → clear → add Record, Expression, Decision table, Function, Switch, Response from Components, link them → configure each (Record schema = the entity's fields; input picked from fields only; status offers only the state machine's states; answers exactly `validation-error, transform, allow`; function body set; switch condition) → Simulator → Try it (a withdrawn student is blocked, an enrolled one goes through) → Save → reload. It also asserts: no starter cards, no "Request", no "Runs when", **zero requests to a CDN**, no page errors.

## Driving the canvas — `lib/rule-graph.ts` (`RuleGraph`)

These took many failed runs to find; do not rediscover them:

- **Delete a node** through its ⋮ menu → *Delete* → the confirmation's **OK**. Ctrl+A / Backspace do nothing useful.
- **Add a node** by pointer-dragging the Components row (`mouse.down`, several `mouse.move` steps, `mouse.up`). Playwright's `dragTo` times out on it. Lay nodes out three to a row at a fixed pitch from the pane's box; "find a free spot" heuristics overlapped nodes and made lines fail.
- **Link** with a stepped pointer path from the source's `.react-flow__handle-right` to the target's `-left`. A single-jump `dragTo` draws nothing.
- Back on the Graph tab the view re-fits, which can make two nodes huge — zoom out (control button 2) until a node is under ~190px wide before adding.
- **Tabs scroll out of reach**: switch with `evaluate(el => el.click())` on `[role=tab]`, not a pointer click. Several `Add row` texts exist (hidden tabs stay mounted) — use `.grl-dt__add-row`.
- **A popup's first click is swallowed** by the previous popup's fade-out: assert it closed, and retry opening until its heading is visible.
- Pick-list options are `.ant-select-item-option-content` (virtual list — fine for ≤ 8 options). Table cells: click the icon at the left (`position:{x:22,y:20}`) to open the operator list, choose *equals*, then click the cell body (`x:90`) for the values.
- **Set code boxes through the model** (`monaco.editor.getEditors()…getModel().setValue`) — typing into Monaco auto-closes brackets and leaves an extra `}`. `window.monaco` is the app's own instance.
- Assert text with `toContainText` on the row/editor, not `getByText` on a cell (code cells split into spans; hidden duplicates exist).
- The answer word is `prevent`: Simulator output shows the compiled vocabulary.

## When you add a test

Add to `RuleGraph` rather than writing coordinates in a spec; keep each step a `test.step` that attaches an editor screenshot; update the table in `scripts/e2e-rules-workflows/README.md`.
