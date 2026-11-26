---
name: rule-editor
description: Work on the business-rule editor — the GoRules decision-graph editor inside the Logic and Enhance steps (RuleEditor, GoRulesEditorPanel, rule-graph-constraints, monaco-local). Use before changing how a rule is drawn, constrained, simulated, saved or helped.
---

# The rule editor

A rule is a GoRules **graph**: Record → (Expression | Decision table | Function | Switch)… → Response, stored as one `%%jdm-graph` line under `%%rule <name> on <Entity> event: …`. Read `.claude/skills/workflow-editor` for how a rule gets its moment.

> The editors live in `packages/editors/src` (shared with generated apps); paths below that start with `components/` or `lib/` are relative to it.

## Files

| File | Job |
|---|---|
| `packages/editors/src/components/eml/RuleEditor.tsx` | Name / Entity / Priority, the panel, Try it, Show EML. Rules from a plain flowchart open read-only or convert |
| `components/eml/GoRulesEditorPanel.tsx` | The editor itself: constraints, Inputs controls, Simulator, Developer/Business, node renames |
| `lib/eml/rule-constraints.ts` | What exists per entity: fields (+ JSON types), allowed values (enum or state machine states), defined processes |
| `lib/eml/rule-graph-constraints.ts` | Types columns as pick-lists, lists names that do not exist, adds/changes input columns, strips the stock function import |
| `lib/monaco-local.ts` | Monaco served by the app — never a CDN |
| `lib/eml/rule-templates.ts` | `tableToGraph`, `sampleRecord` (the starter cards are gone) |
| `content/help/business-rules.md` | The only user-facing explanation; `help-content.test.ts` holds it to the editor |

## Rules that must stay true

1. **Constrained to what exists.** Inputs are picked from the entity's own fields (the editor's own free-text "+" is hidden by CSS); an enum or status column offers only its values (a state machine's states win over an enum; the status column is found by enum overlap, not by name); **Action** offers `validation-error`, `transform`, `allow`; **Workflow Name** lists only that entity's processes. Everything else the graph names is listed in the amber "Names that do not exist" box.
2. **A rule cannot start a workflow.** No starter, no `trigger-workflow` choice. Old stored rows still render and are flagged. Linking is done in the workflow editor only.
3. **No "Runs when" in the rule.** Do not add it back.
4. **The first node is "Record", never "Request".** The library cannot rename it by prop: the panel mutates `nodeSpecification.inputNode` once at module load, and `constrainGraph` renames a stored "Request".
5. **Pick-lists exist only in Business view** (`mode="business"`, the default). Developer view shows plain cells.
6. **Monaco 0.57 vs jdm-editor (built for 0.52).** `monaco-local.ts` re-attaches `languages.typescript` and `languages.json`, which 0.55 moved; without it a Function tab throws `reading 'javascriptDefaults'`. Subpath imports use the package `exports` (`monaco-editor/editor/editor.worker?worker`, not `esm/vs/...`).
7. **A function body cannot `import`.** The editor's default body starts with `import zen from 'zen'`, which `compileRules` refuses. `withoutStockImport` strips it on creation and on display.
8. **The wrapper height trap.** The provider renders `.ant-app { height:100% }`, which in a stretched flex column made the editor as tall as the rail and pushed Try it off the page. The panel's scoped `<style>` fixes it — keep it.
9. **Simulator** posts to `/api/projects/:id/rules/dry-run`, the same compiled path as Try it; its trace is keyed by node id from the route's node-name trace.
10. The answer word is the compiled one: `validation-error` is stored as `prevent`, so a Switch must not test `action == "validation-error"`.

## Before you finish

`bun run type-check`, `bun --filter @appwithai/web test`, then the `rule-editor-e2e` specs 07 and 09. If you touched `help` or the editor's choices, `help-content.test.ts` must still pass.
