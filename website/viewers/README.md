# The model viewers

What a language model writes is a `.eml.mmd`, and Mermaid draws only half of it.
The ERD renders; the rules, the workflows, the enums and the access control live
in `%%` directives Mermaid treats as comments — which is exactly the half a
reader most needs to check while the model is still being written.

These modules draw all of it: the entities and their links, the state machines,
the sagas, the decision flows and the decision tables, the lifecycle hooks and
the roles. They are published at `/viewers/` on the site, and
[`../llmtext/llms.txt`](../llmtext/llms.txt) §1 sends the reader
there at the gates of the walkthrough.

## The one rule

**Nothing here reads a model.** `eml-model.js` is this repository's own parser,
rule compiler, workflow compiler, RBAC derivation and checker, bundled for a
browser by `scripts/build-viewers.ts` from
`packages/generator/src/browser/viewers.ts`. The rest of the files decide how a
column, a state or a step *looks* — never what it is.

A viewer with a parser of its own is a viewer that shows an application nobody
is going to get: it would disagree with the generator about which columns are
foreign keys, which enum binding took, which transition is legal, and the author
would find out only after generating. That is why the reading is a build
artifact and not a second implementation, and why CI compares it byte for byte:

```bash
bun run build:viewers            # rebuild after changing anything it reaches
bun run build:viewers --check    # what CI runs
```

It goes stale when anything under `packages/generator/src/{parsers,rules,hooks,workflows,rbac,pipeline,viewers}`
or `language/` changes.

## The files

| File | What it is |
|---|---|
| `eml-model.js` | **Built.** `inspectModel(source)` → `{ model, report }`. Do not edit |
| `layout.js` | Layered graph placement — rank, order, space. No dependency |
| `canvas.js` | The surface all three pictures are drawn on: pan, zoom, fit, select |
| `erd-viewer.js` | Entity boxes, columns with their badges, crow's-foot relationships |
| `workflow-viewer.js` | State machines on a canvas, sagas as a ladder, hooks as a list |
| `rules-viewer.js` | Decision flows in the five role colours, and what a rule emits |
| `decision-table.js` | A `Decision` step's table, as a table rather than as JSON |
| `model-viewer.js` | The page: input, tabs, diagnostics, the inspector |
| `viewers.css` | Everything is prefixed `awv-` and scoped to `.awv-root` |
| `index.html` | A self-contained page, for running these without the site |

## Running it here

The modules load the example models by relative path, so serve the repository
root rather than this directory:

```bash
python3 -m http.server 8099
# http://127.0.0.1:8099/website/viewers/
```

The published site serves the same files from `/viewers/`; only `index.html`
differs there, because it carries the site's own header and footer.

## The palette is the design tool's

A rule's Decision is amber in `packages/web`'s canvas and amber here; a state a
record starts in is emerald in both; a saga step gets the glyph the automation
ladder gives it. Someone who drew a workflow in the design tool and someone who
had a model written for them should be looking at the same picture. The colours
are custom properties at the top of `viewers.css` — change those, not the rules
that use them.
