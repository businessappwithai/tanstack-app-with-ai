import assert from "node:assert/strict";
import { test } from "vitest";
import { aiModelToYaml, parseEml, projectEmlToAiModel } from "../src/eml/parser";

const source = `%%meta name: Field Service
%%meta kind: erd
%%enum JobStatus: scheduled, dispatched, complete

erDiagram
  Customer {
    string id PK
    string name
  }
  Job {
    string id PK
    string customer_id FK
    string status
  }
  Customer ||--o{ Job : "raises"

%%entity Job help: A visit an engineer makes to a customer site.
%%field Job.status enum: JobStatus
%%rbac role:dispatcher on Job.update
%%workflow JobLifecycle entity: Job kind: state
stateDiagram-v2
  [*] --> Scheduled
  Scheduled --> Complete : finish

%%rule jobGate on Job event: beforeUpdate priority: 10
flowchart TD
  A -->|ok| B
`;

test("EML parser preserves source while extracting model semantics", () => {
  const doc = parseEml(source);
  assert.equal(doc.source, source);
  assert.equal(doc.entities.length, 2);
  assert.equal(doc.relationships.length, 1);
  assert.equal(doc.diagrams.length, 3);
  assert.equal(doc.directives.find((d) => d.kind === "rbac")?.properties.role, "dispatcher");
  assert.equal(doc.directives.find((d) => d.kind === "workflow")?.properties.entity, "Job");
});

test("AI projection is deterministic YAML", () => {
  const model = projectEmlToAiModel(parseEml(source));
  const a = aiModelToYaml(model);
  const b = aiModelToYaml(model);
  assert.equal(a, b);
  assert.match(a, /Customer/);
  assert.match(a, /JobStatus/);
});
