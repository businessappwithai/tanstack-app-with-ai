import { describe, expect, it } from "vitest";
import {
  buildSagaBpmn,
  compileSagas,
  describeSaga,
  orderSteps,
  parseStepProps,
  type SagaSection,
} from "../steps";

const ENTITIES = ["DeviationReport", "Capa"];

function section(diagram: string, overrides: Partial<SagaSection> = {}): SagaSection {
  return {
    name: "Escalation",
    entity: "DeviationReport",
    kind: "saga",
    diagram,
    ...overrides,
  };
}

const CHAIN = `flowchart TD
    A([Deviation reported]) --> B[Stage the SLA]
    B --> C[Compute the window]
    C --> D[Open a CAPA]
    D --> E[Escalate]
    E --> F([Done])

    %%step B Formula target: baseDays operation: set value: 3
    %%step C Formula target: resolutionDays source: baseDays operation: multiply operand: 7
    %%step D CreateEntity entity: bus_capa as: newCapaId fields: {"title":"capaTitle","status":"open"}
    %%step E UpdateEntity field: status value: escalated
`;

describe("a saga bound to a status", () => {
  it("is stored under ENTER:<STATE>, which the runner selects on the move into it", () => {
    const [saga] = compileSagas(
      [section(CHAIN, { trigger: "automatic", operation: "UPDATE", status: "to_be_reviewed" })],
      ENTITIES
    );
    expect(saga?.operation).toBe("ENTER:TO_BE_REVIEWED");
    expect(describeSaga(saga!)).toContain("moves the record to to be reviewed");
  });

  it("drops the status on a rule-triggered saga, which a rule resolves by name", () => {
    const warnings: string[] = [];
    const [saga] = compileSagas(
      [section(CHAIN, { trigger: "rule", operation: "UPDATE", status: "approved" })],
      ENTITIES,
      (message) => warnings.push(message)
    );
    expect(saga?.operation).toBe("UPDATE");
    expect(warnings.join(" ")).toMatch(/status is ignored/);
  });

  it("is untouched when no status is bound", () => {
    const [saga] = compileSagas([section(CHAIN, { operation: "UPDATE" })], ENTITIES);
    expect(saga?.operation).toBe("UPDATE");
  });
});

describe("parseStepProps", () => {
  it("splits on the next key, so a value may contain spaces", () => {
    const props = parseStepProps("target: capaTitle operation: set value: CAPA for a deviation");
    expect(props).toEqual({
      target: "capaTitle",
      operation: "set",
      value: "CAPA for a deviation",
    });
  });

  it("keeps a JSON field map intact when it is the last key", () => {
    const props = parseStepProps('entity: bus_capa fields: {"title":"x","status":"open"}');
    expect(props.entity).toBe("bus_capa");
    expect(JSON.parse(props.fields!)).toEqual({ title: "x", status: "open" });
  });

  it("returns nothing for an empty tail rather than an empty-keyed entry", () => {
    expect(parseStepProps("   ")).toEqual({});
  });

  // Regression: ISSUE-001 — a URL scheme was read as the next property key, so
  // `url: https://host/path` compiled to url "" plus a property called "https".
  // Every REST step failed EML262 for a url it plainly had, and the model would
  // not generate at all.
  // Found by /qa on 2026-09-01
  // Report: .gstack/qa-reports/qa-report-dance-studio-qa-2026-09-01.md
  it("does not split a value at a URL scheme", () => {
    const props = parseStepProps("url: https://receipts.example.com/hooks/x method: POST");
    expect(props).toEqual({
      url: "https://receipts.example.com/hooks/x",
      method: "POST",
    });
  });

  it("keeps a URL whole when it is the last key, and when a body follows", () => {
    expect(parseStepProps("method: POST url: http://localhost:4001/notify").url).toBe(
      "http://localhost:4001/notify"
    );
    const withBody = parseStepProps('url: https://host/p method: POST bodyTemplate: {"a":"{{b}}"}');
    expect(withBody.url).toBe("https://host/p");
    expect(JSON.parse(withBody.bodyTemplate!)).toEqual({ a: "{{b}}" });
  });

  it("still starts a new property at a plain key, URLs aside", () => {
    expect(parseStepProps("target: t operation: set value: a b c")).toEqual({
      target: "t",
      operation: "set",
      value: "a b c",
    });
  });
});

describe("compileSagas", () => {
  it("reads the steps a flowchart declares", () => {
    const [saga] = compileSagas([section(CHAIN)], ENTITIES);
    expect(saga?.steps.map((step) => step.nodeId)).toEqual(["B", "C", "D", "E"]);
    expect(saga?.steps.map((step) => step.type)).toEqual([
      "Formula",
      "Formula",
      "CreateEntity",
      "UpdateEntity",
    ]);
  });

  it("takes the BPMN task name from the node's label", () => {
    const [saga] = compileSagas([section(CHAIN)], ENTITIES);
    expect(saga?.steps[0]?.label).toBe("Stage the SLA");
  });

  it("orders steps by the flowchart edges, not by directive order", () => {
    const shuffled = `flowchart TD
    A --> B
    B --> C

    %%step C Formula target: second operation: set value: 2
    %%step B Formula target: first operation: set value: 1
`;
    const [saga] = compileSagas([section(shuffled)], ENTITIES);
    expect(saga?.steps.map((step) => step.props.target)).toEqual(["first", "second"]);
  });

  it("still runs a step whose node was never wired up", () => {
    const orphan = `flowchart TD
    A --> B

    %%step B Formula target: wired operation: set value: 1
    %%step Z Formula target: orphan operation: set value: 2
`;
    const [saga] = compileSagas([section(orphan)], ENTITIES);
    expect(saga?.steps.map((step) => step.props.target)).toEqual(["wired", "orphan"]);
  });

  it("defaults to an automatic CREATE trigger", () => {
    const [saga] = compileSagas([section(CHAIN)], ENTITIES);
    expect(saga?.trigger).toBe("automatic");
    expect(saga?.operation).toBe("CREATE");
  });

  it("honours a rule trigger", () => {
    const [saga] = compileSagas([section(CHAIN, { trigger: "rule", operation: "ALL" })], ENTITIES);
    expect(saga?.trigger).toBe("rule");
    expect(saga?.operation).toBe("ALL");
  });

  it("skips a workflow bound to an entity the model does not declare", () => {
    const warnings: string[] = [];
    const compiled = compileSagas([section(CHAIN, { entity: "Nonexistent" })], ENTITIES, (m) =>
      warnings.push(m)
    );
    expect(compiled).toHaveLength(0);
    expect(warnings[0]).toContain("Nonexistent");
  });

  it("skips an unknown step type instead of emitting a task the executor cannot run", () => {
    const warnings: string[] = [];
    const compiled = compileSagas(
      [
        section(`flowchart TD
    A --> B
    %%step B Teleport target: x
`),
      ],
      ENTITIES,
      (m) => warnings.push(m)
    );
    expect(compiled).toHaveLength(0);
    expect(warnings.some((m) => m.includes("Teleport"))).toBe(true);
  });

  it("keeps the first %%step when a node carries two", () => {
    const warnings: string[] = [];
    const [saga] = compileSagas(
      [
        section(`flowchart TD
    A --> B
    %%step B Formula target: first operation: set value: 1
    %%step B Formula target: second operation: set value: 2
`),
      ],
      ENTITIES,
      (m) => warnings.push(m)
    );
    expect(saga?.steps).toHaveLength(1);
    expect(saga?.steps[0]?.props.target).toBe("first");
    expect(warnings.some((m) => m.includes("more than one"))).toBe(true);
  });

  it("ignores a state workflow", () => {
    const compiled = compileSagas([section(CHAIN, { kind: "state" })], ENTITIES);
    expect(compiled).toHaveLength(0);
  });

  it("skips a saga with no %%step at all", () => {
    const warnings: string[] = [];
    const compiled = compileSagas([section("flowchart TD\n    A --> B\n")], ENTITIES, (m) =>
      warnings.push(m)
    );
    expect(compiled).toHaveLength(0);
    expect(warnings[0]).toContain("no %%step");
  });
});

describe("orderSteps", () => {
  it("does not loop forever on a cycle", () => {
    const declared = new Map([
      ["B", { nodeId: "B", type: "Formula" as const, label: "B", props: {} }],
    ]);
    const ordered = orderSteps("flowchart TD\n A --> B\n B --> A\n", declared);
    expect(ordered).toHaveLength(1);
  });
});

describe("buildSagaBpmn", () => {
  it("emits one service task per step, chained start to end", () => {
    const [saga] = compileSagas([section(CHAIN)], ENTITIES);
    const xml = buildSagaBpmn(saga!, "bus_deviation_report");

    expect(xml.match(/<bpmn:serviceTask/g)).toHaveLength(4);
    expect(xml).toContain('sourceRef="start" targetRef="B"');
    expect(xml).toContain('sourceRef="E" targetRef="end"');
    expect(xml).toContain('<appwithai:property name="nodeType" value="CreateEntity" />');
    expect(xml).toContain('<appwithai:property name="as" value="newCapaId" />');
  });

  it("escapes the quotes in a JSON field map so the XML stays parseable", () => {
    const [saga] = compileSagas([section(CHAIN)], ENTITIES);
    const xml = buildSagaBpmn(saga!, "bus_deviation_report");
    expect(xml).toContain("&quot;title&quot;");
    expect(xml).not.toContain('value="{"title"');
  });
});

describe("describeSaga", () => {
  it("says what runs it and in what order", () => {
    const [saga] = compileSagas([section(CHAIN, { trigger: "rule" })], ENTITIES);
    const description = describeSaga(saga!);
    expect(description).toContain("4 steps");
    expect(description).toContain("runs when a rule triggers it");
    expect(description).toContain("Formula → Formula → CreateEntity → UpdateEntity");
  });
});
