# AppWithAI YAMLtecture TypeScript design and research notes

## Goal

Translate the useful parts of UnitVectorY-Labs/YAMLtecture into TypeScript so AppWithAI can use its validated graph, hierarchy, query and deterministic rendering ideas without changing the existing AppWithAI application generator.

The generator remains Mermaid/EML + template based. The TypeScript layer sits outside it.

## Recommended architecture

```text
                         Git
                          │
              ┌───────────┴───────────┐
              │                       │
        business.eml.mmd       business.ai.yaml
              │                       │
              │                       ▼
              │                  AI / Agent
              │                       │
              │               YAMLtecture-TS
              │                       │
              │          graph/query/context selection
              │                       │
              │                       ▼
              │               typed operations
              │                       │
              │                      Zod
              │                       │
              └───────────◄───────────┘
                          │
                    EMLModelGateway
                          │
                          ▼
                  business.eml.mmd
                          │
                          ▼
                  EXISTING CHECKER
                          │
                          ▼
                       PASS
                          │
              ┌───────────┴───────────┐
              │                       │
       regenerate YAML            Git commit
              │
              ▼
        business.ai.yaml
```

## Why keep versioned YAML

Keeping a persistent AI-facing YAML projection is useful, but the value is not that YAML is universally superior to every other prompt format. The value is that it gives the agent a compact, structured and Git-diffable semantic view of the model.

Git can retain every historical YAML projection automatically. An agent can retrieve the current projection and a small number of relevant historical versions/diffs without stuffing all history into the context window.

## Source-of-truth rule

`business.eml.mmd` remains canonical. `business.ai.yaml` is a deterministic materialized AI view.

This prevents the system from having two competing modelling languages. Do not let users or agents independently change both and then guess which one wins.

## AI input and output

Recommended input to an AI agent:

```text
current AI YAML projection
+ relevant historical YAML/diff
+ relevant business request
+ relevant EML rules
```

Recommended AI output:

```text
typed JSON/tool operations -> Zod -> EMLModelGateway
```

Do not normally ask the model to rewrite the entire YAML or the entire `.mmd` file.

## Why port YAMLtecture rather than just execute its Go CLI

A TypeScript implementation integrates naturally with the AppWithAI TypeScript stack and allows the graph/query/context engine to be called directly by agents and gateways.

The port preserves the useful YAMLtecture concepts:

- nodes and links
- parent hierarchy
- validation
- query filtering
- `equals`, `notEquals`, `exists`
- `and`, `or`
- `ancestorOf`, `descendantOf`, `parentOf`, `childOf`
- deterministic Mermaid flowchart rendering

It also deliberately improves two upstream behaviors for the AppWithAI use case:

1. YAMLtecture currently assigns random UUIDs to links when loading. This port creates stable deterministic IDs so Git diffs and AI references do not change on every parse.
2. YAMLtecture declares arbitrary attributes but its current validation path effectively assumes string values. This port supports nested recursive structured attributes so AppWithAI fields, rules, lifecycles and related metadata can be represented naturally.

## Generic Mermaid vs AppWithAI EML

The generic YAMLtecture-style `generateFlowchart()` renderer is retained for architecture visualization only.

It must not replace the existing AppWithAI EML generator/compiler path. AppWithAI EML contains application semantics in Mermaid diagrams and `%%` directives, including entities, fields, enums, RBAC, reports, rules, workflows, hooks, triggers and steps.

## AppWithAI website compatibility test

The Try It Yourself page currently references these six models:

| Model | Advertised entities | Parsed entities | Relationships | State diagrams | Flowcharts |
|---|---:|---:|---:|---:|---:|
| CRM | 17 | 17 | 39 | 5 | 20 |
| Dance Studio | 9 | 9 | 10 | 2 | 4 |
| Hospital | 30 | 30 | 55 | 10 | 35 |
| Drug Discovery | 19 | 19 | 31 | 3 | 9 |
| Wealth Management | 91 | 91 | 137 | 11 | 15 |
| Education | 19 | 19 | 31 | 11 | 21 |

During the compatibility analysis there were zero entity-count mismatches, zero directive-head parse failures and zero unknown directive families across those six files.

The recognized EML directive families were:

```text
%%meta
%%category
%%enum
%%entity
%%field
%%index
%%rbac
%%report
%%rule
%%action
%%workflow
%%trigger
%%hook
%%step
```

plus ordinary `%%` comments.

## Current implementation boundary

This package currently provides the graph/query/validation foundation, generic deterministic flowchart generation, EML structural extraction, deterministic AI projection and Git read/commit helpers.

The next major layer should be an `EMLModelGateway` with constrained mutation operations such as:

```text
addEntity
addField
changeField
addRelationship
addEnum
addRule
addWorkflow
addHook
addSaga/step
updateHelp
updateAccess
```

That gateway should make surgical changes to canonical EML, run the existing AppWithAI checker, regenerate the YAML projection, and commit the pair only when validation succeeds.

## Licensing

YAMLtecture is MIT licensed. This package retains the upstream notice in `THIRD_PARTY_NOTICES.md` and includes an MIT `LICENSE` for the translated/extended package.
