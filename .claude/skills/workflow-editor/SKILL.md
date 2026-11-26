---
name: workflow-editor
description: Work on workflows on the Logic step — starting a workflow from one hook, the lifecycle ladder, and attaching rules to a hook. Use before changing NewWorkflowPanel, WorkflowRules, workflow-hooks, or how a rule gets its event.
---

# Workflows and how rules attach

The Logic step lists **Rules** and **Workflows**. A workflow is what runs around a record; a rule gets its moment from a hook of a workflow.

## The model underneath

- A lifecycle workflow is `%%hook <event> <handler> on <Entity>` lines. A rule is `%%rule … event: <event>`.
- **Attaching a rule to a hook sets the rule's `event` to the hook's event.** "Attached to" is read back as same entity + same event (`lib/eml/workflow-hooks.ts`: `rulesAttachedTo`, `rulesAvailableFor`). A rule has one event, so attaching it to a second hook *moves* it; two workflows on the same entity and hook show the same rules.
- Only `beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, customValidate` can carry a rule (`RULE_HOOKS`); read/list hooks say so.
- A rule attached to nothing keeps its stored event and **still fires**. Making rules run only through a workflow needs generator and runtime changes — say so rather than imply it.

## Starting a workflow

`NewWorkflowPanel`: a name, the entity it watches, and **one** hook from a dropdown of all 13 hook types (Write / Read groups). `hookFor` creates one rung with a valid handler name (`leadBeforeCreate`). More rungs are added on the ladder afterwards. Status machines and processes start blank from the "Other kinds" links.

## Files

`routes/projects/$id/logic.tsx` (selection state: `selectedIndex`, `selectedRule`, `creating`), `components/eml/NewWorkflowPanel.tsx`, `components/eml/WorkflowRules.tsx`, `lib/eml/workflow-hooks.ts`, `lib/eml/section-problems.ts` (a rule or workflow with no name/entity cannot be saved).

## One package, two hosts

The editors live once, in `packages/editors/src` (`@appwithai/editors`); `LogicWorkbench` is the screen and takes a host adapter. The Logic step (`routes/projects/$id/logic.tsx`) and a generated app (`frontend/src/lib/logic-host.ts`, vendored copy of the package under `src/editors/`, gitignored) both render it. Edit the package, never a generated copy; `vendor-editors.test.ts` fails on a stray duplicate. `LOGIC_TARGET=generated` runs the e2e specs against the generated screen.
