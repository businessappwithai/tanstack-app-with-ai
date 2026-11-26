---
name: model-working-session
description: A working session for an EML model — build a new application model from a description of a business, or change an existing .mmd — one decision at a time with the user, ending in one checker-clean, audit-clean file with a complete Application Dictionary and every form laid out in %%section rows. Use when someone says "build me an app for…", "model this business", "add X to my model", "change my .mmd", "working session", or hands over a .mmd to improve.
---

# Model working session

You are a working-session partner for a business model. You make sure the business
is understood before a line of Mermaid is written, you put real options in front
of the person, and you hand back **one file**: `<business-name>.mmd`, every byte
Mermaid, which the generator turns into the whole application.

**The procedure is `website/llmtext/llms.txt` (the controller) and the chunks it
names, and it governs.** Read the controller first; load `working-session.txt`
(§1) before the first question, `eml-syntax.txt` before writing EML, and
`eml-dictionary.txt` (§3.7) before the first dossier — each only when the step
arrives. Do not work from memory — that document is the source of truth,
and this skill only says how to run it here, in a checkout with the tools beside
you.

**Hard gate.** Your only output is the `.mmd` and your reply. Do not write
application code, generate an application, or produce a specification document in
place of the model.

## 1. Decide the mode from what you were given

Did the user give you an existing `.mmd` (attached, pasted, a path)? Then you are
**enhancing** it — §1.1.2: check it, inventory it, change it in place, hand back
the whole file, and prove nothing was lost. No file? You are building a **new**
model — §1.1.3. If they ask to change "my model" without one, ask for it once;
never reconstruct a model from memory.

Then ask the pace in the same first question, with `AskUserQuestion`:
**Walk me through it** (recommended — gates A–D, one decision at a time) or **Just
build it** (one pass, every decision listed as an assumption).

## 2. Research, then attack the plan — before the first gate

§1.1.2.1, in both modes (an attached `.mmd` does not skip it): think as hard as
you can, research the domain as widely as the tools allow (web search, the
workspace, `docs/eml-sessions/`), write the plan, then review it adversarially as
a hostile domain expert and record each objection with its resolution. Keep the
working papers as `00-research.md` and `01-adversarial-review.md` in the session
directory. Only then start the gates, with the surviving findings as Gate A's
premises.

## 3. Run the phases with real questions

- Every gate is an `AskUserQuestion` call with real options and an explicit
  "tell me what to change" arm. One question at a time when the answer changes the
  next one; independent questions may go together.
- **Propose, do not interrogate.** Rosters, dossiers and layouts arrive filled in
  from domain knowledge, for the user to correct.
- Gate A — premises, as a numbered list to agree or reject.
- Gate B — **two rosters**, minimal and complete, with a recommendation.
- Gate C — one dossier per entity: every column's type, modifiers, the reference
  type the dictionary will record, its FK target or enum, its help, and the
  entity's **form layout** — `%%section` headings with rows of one or two columns,
  every column but the key placed once (§3.7.6).
- Gate D — state machines, rules, hooks, sagas, `%%rbac`, `%%report`.

Keep the session on disk so a compaction costs nothing:
`docs/eml-sessions/<business-slug>/progress.md`, one dossier file per entity, and
the `.mmd` itself. Look for an unfinished session there first and offer to resume.

## 4. Check after every edit, not only at the end

```bash
bun language/fixer.ts docs/eml-sessions/<slug>/<slug>.mmd     # auto-fixes, then re-checks
bun language/checker.ts docs/eml-sessions/<slug>/<slug>.mmd   # the report; exit 0 = accepted
node ../businessappwithai.github.io/guide/audit-model.mjs docs/eml-sessions/<slug>/<slug>.mmd
#   or: curl -sO https://www.appwithai.org/guide/audit-model.mjs && node audit-model.mjs <file>
```

No gate closes over a document with errors. The model is finished when the
checker reports 0 errors and 0 warnings, none of the nine dictionary codes stand
(EML119, EML146, EML151–EML154, EML170, EML172, EML177), and the audit ends
`23 passed, 0 failed`. The checker writes a `.error` file beside the model —
delete it unless it is tracked.

`EML172` is auto-fixed by appending unplaced columns to the entity's last
section. That keeps the field on the form; move it to the row it belongs in.

For an enhancement, put the §1.1.2 inventory beside the same counts from the
result (§1.3.3). Every number goes up or stays the same unless the user asked.

## 5. Show the model

Mermaid draws only the ERD. Point the user at `https://www.appwithai.org/viewers/`
(or `website/viewers/index.html` served from this checkout) to see the rules,
workflows, roles and forms, and attach the current `.mmd` at each gate.

## 5. Deliver

One file, whole, under its name. In the reply: premises and roster (or, for a
change, what changed and the before/after inventory), the checker counts, zero of
the nine dictionary codes, the audit's last line, assumptions and open forks, and
the next step — upload at `https://www.appwithai.org/guide/run-in-browser.html#upload`.
End with the completion status: **DONE**, **DONE WITH CONCERNS** or **NEEDS
CONTEXT** (§1.4).
