/**
 * The viewers see what the generator sees.
 *
 * `readModel` composes the real parser and the real compilers, so what these
 * assert is not that a second reading agrees with the first — there is no
 * second reading — but the three things composition can still get wrong:
 *
 *   pairing      a compiled rule back to the flowchart it came from, and a
 *                compiled workflow back to the `%%meta name:` above it
 *   derivation   the column a state machine drives, the states no enum
 *                declares, the properties a step is missing
 *   tolerance    a half-written document is the normal case here, because the
 *                whole point is watching one being written. Nothing may throw
 *
 * The last of those is the one worth having: a viewer that throws on an
 * incomplete model is a viewer that goes blank at exactly the moment a reader
 * wants it, and every gate of the walkthrough in `website/llmtext/llms.txt` ends
 * with a document that is incomplete on purpose.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseModel } from "../../pipeline/parse-model";
import { readModel } from "../view-model";

const ROOT = join(import.meta.dirname, "../../../../..");
const crm = readFileSync(join(ROOT, "language/examples/crm.eml.mmd"), "utf-8");

describe("readModel composes the pipeline's own reading", () => {
  it("carries every entity, relationship and enum the parser found", () => {
    const parsed = parseModel(crm);
    const view = readModel(crm);

    expect(view.entities.map((entity) => entity.name)).toEqual(
      parsed.entities.map((entity) => entity.name)
    );
    expect(view.relationships).toEqual(parsed.relationships);
    expect(view.enums).toEqual(parsed.enums);
    expect(view.hooks).toEqual(parsed.hooks);
    expect(view.rbac).toEqual(parsed.rbac);

    // The stats are what the page prints in its header; a count that disagrees
    // with the list beneath it is worse than no count.
    expect(view.stats.entities).toBe(view.entities.length);
    expect(view.stats.fields).toBe(
      view.entities.reduce((total, entity) => total + entity.attributes.length, 0)
    );
    expect(view.stats.relationships).toBe(view.relationships.length);
  });

  it("pairs each rule section with what it compiled to", () => {
    const view = readModel(crm);
    const parsed = parseModel(crm);

    expect(view.rules).toHaveLength(parsed.rules.length);
    for (const rule of view.rules) {
      const compiled = parsed.rules.find((candidate) => candidate.name === rule.name);
      expect(compiled).toBeDefined();
      expect(rule.compiled).toBe(true);
      expect(rule.operation).toBe(compiled?.operation);
      expect(rule.tableName).toBe(compiled?.tableName);
      // The flowchart is what the section drew, and every rule in this model
      // draws one — a rule with no nodes is a rule the viewer cannot show.
      expect(rule.nodes.length).toBeGreaterThan(0);
      expect(rule.edges.length).toBeGreaterThan(0);
    }
  });

  it("reads a node's role from its shape, the way the rule compiler does", () => {
    const view = readModel(crm);
    const rule = view.rules.find((candidate) => candidate.name === "leadScoring");
    expect(rule).toBeDefined();

    const roles = new Set(rule?.nodes.map((node) => node.role));
    expect(roles.has("start")).toBe(true);
    expect(roles.has("decision")).toBe(true);
    expect(roles.has("action")).toBe(true);

    // A stadium node with nothing leaving it is the result, not a second start.
    const ends = rule?.nodes.filter((node) => node.role === "end") ?? [];
    for (const end of ends) {
      expect(rule?.edges.some((edge) => edge.source === end.id)).toBe(false);
    }
  });

  it("resolves the column a state machine writes to, and the states it cannot hold", () => {
    const view = readModel(crm);
    const lifecycle = view.workflows.find((workflow) => workflow.name === "LeadLifecycle");

    expect(lifecycle?.entity).toBe("Lead");
    expect(lifecycle?.statusColumn).toBe("status");
    // Every state of this model is a declared enum value; that is the standard
    // the example models are held to, and the viewer's warning must not fire.
    expect(lifecycle?.undeclaredStates).toEqual([]);
    expect(lifecycle?.declaredValues).toEqual(expect.arrayContaining(["new", "working"]));
  });

  it("reports a state no enum declares", () => {
    const source = [
      "%%meta name: Gap",
      "%%enum TicketStatus: open, closed",
      "%%field Ticket.status enum: TicketStatus",
      "erDiagram",
      "    Ticket {",
      "        string id PK",
      "        string status",
      "    }",
      "",
      "%%workflow TicketFlow entity: Ticket kind: state",
      "stateDiagram-v2",
      "    [*] --> open",
      "    open --> escalated : escalate",
      "    escalated --> closed : close",
      "    closed --> [*]",
    ].join("\n");

    const view = readModel(source);
    const flow = view.workflows[0];
    expect(flow?.statusColumn).toBe("status");
    expect(flow?.undeclaredStates).toEqual(["escalated"]);
  });

  it("names the saga that moves a record into each state it writes", () => {
    // A state is changed only by background workflows: LeadConversion's
    // UpdateEntity step is what puts a Lead in `converted`.
    const view = readModel(crm);
    const lifecycle = view.workflows.find((workflow) => workflow.name === "LeadLifecycle");
    expect(lifecycle?.stateWriters.converted).toContain("LeadConversion");
    for (const [state, writers] of Object.entries(lifecycle?.stateWriters ?? {})) {
      expect(lifecycle?.states.map((item) => item.name)).toContain(state);
      expect(writers.length).toBeGreaterThan(0);
    }
  });

  it("says what a saga step publishes and what it is missing", () => {
    const view = readModel(crm);
    const conversion = view.sagas.find((saga) => saga.name === "LeadConversion");
    expect(conversion).toBeDefined();

    // Nothing in a published example may be missing a required property.
    for (const step of conversion?.steps ?? []) expect(step.missing).toEqual([]);

    const created = conversion?.steps.find((step) => step.type === "CreateEntity");
    expect(created?.publishes.length).toBeGreaterThan(0);
  });

  it("reports a step the executor could not run", () => {
    const source = [
      "%%meta name: Half written",
      "erDiagram",
      "    Order {",
      "        string id PK",
      "        string reference",
      "    }",
      "",
      "%%workflow Fulfil entity: Order kind: saga trigger: automatic operation: CREATE",
      "flowchart TD",
      "    S1[Call the warehouse]",
      "    %%step S1 REST method: POST",
    ].join("\n");

    const view = readModel(source);
    const step = view.sagas[0]?.steps[0];
    expect(step?.type).toBe("REST");
    expect(step?.missing).toContain("url");
  });

  it("derives the roles and the per-role entity counts both stacks seed", () => {
    const view = readModel(crm);
    expect(view.access.scoped).toBe(true);
    expect(view.access.roles.map((role) => role.name)).toContain("Administrator");
    // The administrator reads everything; that is the denominator the page prints.
    expect(view.access.entityCounts.Administrator).toBe(view.entities.length);

    const restricted = view.entities.filter((entity) => entity.readableBy.length > 0);
    expect(restricted.length).toBeGreaterThan(0);
  });

  it("reads the document's own %%meta and not a section's", () => {
    const view = readModel(crm);
    expect(view.meta.name).toBe("Enterprise CRM");
    // Every rule and workflow section opens with a `%%meta name:` of its own;
    // taking the last would title the model after whichever came last.
    expect(view.meta.name).not.toBe(view.rules.at(-1)?.title);
  });

  it("reads a document that is still being written", () => {
    /* Each of these is a real intermediate state of the walkthrough in
       `website/llmtext/llms.txt`: the header alone, the header and one
       entity, an entity block left open mid-line. None may throw, and none may
       report a structure the document does not have. */
    const partials = [
      "",
      "   \n\n  ",
      "%%meta name: Field Service",
      "%%meta name: Field Service\n%%meta version: 1.0.0\nerDiagram",
      "%%meta name: Field Service\nerDiagram\n    Job {\n        string id PK",
      "%%meta name: Field Service\nerDiagram\n    Job {\n        string id PK\n    }\n\n%%rule half on Job event:",
      "%%workflow Orphan entity: Nowhere kind: state\nstateDiagram-v2\n    [*] --> draft",
      "not a model at all, just prose about one",
    ];

    for (const partial of partials) {
      expect(() => readModel(partial)).not.toThrow();
      const view = readModel(partial);
      expect(view.stats.entities).toBe(view.entities.length);
      expect(Array.isArray(view.warnings)).toBe(true);
    }
  });

  it("collects the compilers' warnings instead of losing them to the console", () => {
    const source = [
      "%%meta name: Orphaned",
      "erDiagram",
      "    Job {",
      "        string id PK",
      "    }",
      "",
      "%%workflow Orphan entity: Nowhere kind: state",
      "stateDiagram-v2",
      "    [*] --> draft",
      "    draft --> done",
    ].join("\n");

    const view = readModel(source);
    expect(view.workflows).toHaveLength(0);
    expect(view.warnings.join(" ")).toContain("Nowhere");
  });
});
