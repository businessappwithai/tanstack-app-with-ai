# AppWithAI website model compatibility

Acceptance source: the six built-in `.eml.mmd` paths referenced by `assets/js/run-in-browser.js` in `businessappwithai/businessappwithai.github.io` on 2026-09-24.

The compatibility pass uses the same EML extraction rules implemented in `src/eml/parser.ts`: preserve the original source, identify all `%%` directive heads, parse the ER entity/field blocks and relationships, and identify state/flowchart sections.

| Model | Lines | Entities advertised | Entities parsed | ER fields | ER relationships | State diagrams | Flowcharts | Unknown directive kinds | Directive parse failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CRM | 1,451 | 17 | 17 | 212 | 39 | 5 | 20 | 0 | 0 |
| Dance studio | 355 | 9 | 9 | 61 | 10 | 2 | 4 | 0 | 0 |
| Hospital management | 1,803 | 30 | 30 | 323 | 55 | 10 | 35 | 0 | 0 |
| Drug discovery | 1,033 | 19 | 19 | 187 | 31 | 3 | 9 | 0 | 0 |
| Wealth management | 2,448 | 91 | 91 | 642 | 137 | 11 | 15 | 0 | 0 |
| Education management | 1,188 | 19 | 19 | 178 | 31 | 11 | 21 | 0 | 0 |

Recognized EML directive kinds across the fixtures: `meta`, `category`, `enum`, `entity`, `field`, `index`, `rbac`, `report`, `rule`, `action`, `workflow`, `trigger`, `hook`, and `step`, plus ordinary `%%` comments.

## Result

All six website fixtures matched the entity counts advertised by the Try It Yourself page, all diagram headers were recognized, every EML directive head was recognized, and there were zero directive-head parse failures.

This is deliberately a non-destructive compatibility test. The canonical `.mmd` is not rewritten by the parser. `model.ai.yaml` is generated as an AI-facing projection from the `.mmd`; accepted model changes should be applied through the EML gateway and then the YAML projection regenerated.

## Important remaining validation

The TypeScript port does **not** replace AppWithAI's published EML checker. Before a generated/changed `.mmd` is committed, run the existing AppWithAI checker as the final language authority. This package adds structural/query/AI/Git tooling around that canonical validation step.

## Re-run locally

The bundle now includes an executable compatibility test:

```bash
bun run test:website
```

It fetches the current six model files from `https://www.appwithai.org/guide/models/`, parses them with this package, and verifies the expected entity/state-diagram/flowchart counts. This makes the compatibility check repeatable against the website as it evolves.
