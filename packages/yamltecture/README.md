# @appwithai/yamltecture

TypeScript/Bun-oriented port and extension of the useful YAMLtecture concepts for AppWithAI.

It deliberately keeps the existing AppWithAI generator unchanged: `.mmd` + template files remain the generator inputs. This package sits outside the generator and provides:

- YAML architecture loading/validation using `yaml` + Zod
- YAMLtecture-compatible nodes, links, parent hierarchy and query operators
- deterministic link IDs and deterministic ordering for Git-friendly output
- hierarchy/query context selection for AI agents
- deterministic generic Mermaid flowchart rendering
- an AppWithAI EML parser that preserves every source line and extracts entities, fields, relationships, directives and diagrams
- a deterministic AI-facing YAML projection from canonical `.mmd`
- Git history/diff helpers for retrieving previous AI projections

## Architectural rule

`model.mmd` remains authoritative. `model.ai.yaml` is a deterministic AI projection and should be regenerated from the `.mmd` after accepted changes.

```text
model.mmd -> parse EML -> model.ai.yaml -> AI context
    ^                                  |
    |------ typed changes/gateway -----|
```

Do not make the generic YAMLtecture Mermaid renderer the AppWithAI EML generator. `generateFlowchart()` is for visualization. The existing AppWithAI generator continues to consume the canonical `.mmd`.

## Workspace integration

Install from the repository root with `bun install --frozen-lockfile`. This private workspace package exports pure TypeScript modules; it has no server, database, or process-spawning dependency. Git helpers under `@appwithai/yamltecture/git` require a host-supplied port.

The web application's project repository coordinator writes `.appwithai/model.ai.yaml` beside each saved EML snapshot, archives projections for older model versions, and stores `.appwithai/generated-model.ai.yaml` for the exact input used by generation. Restore regenerates the projection from the restored EML. The assistant receives bounded entity context and recent projection changes. The Local Git panel provides YAML and relationship-diagram downloads.

The ZIP's research and packaging reports are retained as upstream reference material. They are not application instructions or evidence of tests run in this repository. See `RUN_LOCAL.md` for current commands.

## Core example

```ts
import { parseArchitectureYaml, executeQuery, generateFlowchart } from "@appwithai/yamltecture";

const graph = parseArchitectureYaml(source);
const subset = executeQuery(graph, {
  nodes: { filters: [{ condition: { field: "type", operator: "equals", value: "Entity" } }] },
  links: { filters: [] }
});

console.log(generateFlowchart(subset));
```

## AppWithAI projection

```ts
import { parseEml, projectEmlToAiModel, aiModelToYaml } from "@appwithai/yamltecture";

const document = parseEml(mmdSource);
const projection = projectEmlToAiModel(document);
const yaml = aiModelToYaml(projection);
```

## Test

```bash
node --experimental-strip-types --test test/*.test.ts
```

The package is designed for Bun, but the dependency-free core tests also run on Node 22+.

## Local test bundle

See [`RUN_LOCAL.md`](./RUN_LOCAL.md) for step-by-step commands.

Useful commands:

```bash
bun install
bun run test
bun run typecheck
bun run test:website
bun run inspect -- /path/to/model.eml.mmd
bun run project -- /path/to/model.eml.mmd /path/to/model.ai.yaml
```

`test:website` checks the exact six worked models currently published under the AppWithAI Try It Yourself experience. It requires internet access; all unit tests run locally.
