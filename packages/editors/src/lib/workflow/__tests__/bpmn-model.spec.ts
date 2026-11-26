import { describe, expect, it } from "vitest";
import {
  analyzeVariables,
  consumedBy,
  type DecisionTable,
  emptyDecisionTable,
  missingRequirements,
  parseDecisionTable,
  publishedBy,
  serializeDecisionTable,
  validateDecisionTable,
  type WorkflowStep,
} from "../bpmn-model";

const step = (
  id: string,
  type: string,
  props: Record<string, string>,
  name = id
): WorkflowStep => ({ id, name, type, props });

const severityTable: DecisionTable = {
  hitPolicy: "first",
  inputs: [{ id: "i1", name: "Severity", field: "severity" }],
  outputs: [
    { id: "o1", name: "Priority", field: "priority" },
    { id: "o2", name: "Owner", field: "owner" },
  ],
  rules: [{ _id: "r1", i1: '"critical"', o1: "1", o2: "'QA'" }],
};

describe("publishedBy", () => {
  it("names a create's bound id, falling back to the entity name", () => {
    expect(publishedBy(step("a", "CreateEntity", { entity: "bus_capa", as: "newCapaId" }))).toEqual(
      ["newCapaId"]
    );
    expect(publishedBy(step("a", "CreateEntity", { entity: "bus_capa" }))).toEqual(["capaId"]);
    expect(publishedBy(step("a", "CreateEntity", {}))).toEqual([]);
  });

  it("names a formula's target", () => {
    expect(publishedBy(step("a", "Formula", { target: "slaDays" }))).toEqual(["slaDays"]);
  });

  it("names every output column of a decision table", () => {
    const props = { decisionTable: serializeDecisionTable(severityTable) };
    expect(publishedBy(step("a", "Decision", props))).toEqual(["priority", "owner"]);
  });

  it("narrows a decision to its publish allow-list", () => {
    const props = { decisionTable: serializeDecisionTable(severityTable), publish: "owner" };
    expect(publishedBy(step("a", "Decision", props))).toEqual(["owner"]);
  });

  it("trusts the allow-list when the table lives in a named rule", () => {
    // The rule's JDM is not here to read, so `publish` is the only declaration.
    const props = { rule: "ClassifySeverity", publish: "priority, slaDays" };
    expect(publishedBy(step("a", "Decision", props))).toEqual(["priority", "slaDays"]);
    expect(publishedBy(step("a", "Decision", { rule: "ClassifySeverity" }))).toEqual([]);
  });
});

describe("consumedBy", () => {
  it("reads source and targetSource", () => {
    const props = { source: "resolutionDays", targetSource: "newCapaId", field: "metric" };
    expect(consumedBy(step("a", "UpdateEntity", props)).sort()).toEqual([
      "newCapaId",
      "resolutionDays",
    ]);
  });

  it("reads the values of a create's column map", () => {
    const props = { entity: "bus_capa", fields: '{"title":"capaTitle","status":"open"}' };
    expect(consumedBy(step("a", "CreateEntity", props)).sort()).toEqual(["capaTitle", "open"]);
  });

  it("survives a column map that does not parse", () => {
    expect(consumedBy(step("a", "CreateEntity", { fields: "{ not json" }))).toEqual([]);
  });

  it("reads the keys a REST body interpolates", () => {
    const props = { url: "https://x", bodyTemplate: '{"id":"{{ newCapaId }}","n":"{{name}}"}' };
    expect(consumedBy(step("a", "REST", props)).sort()).toEqual(["name", "newCapaId"]);
  });

  it("reads the fields a decision table tests", () => {
    const props = { decisionTable: serializeDecisionTable(severityTable) };
    expect(consumedBy(step("a", "Decision", props))).toEqual(["severity"]);
  });
});

describe("analyzeVariables", () => {
  const flow: WorkflowStep[] = [
    step("B", "Decision", { decisionTable: serializeDecisionTable(severityTable) }, "Classify"),
    step("C", "Formula", { target: "slaDays", operation: "set", value: "3" }, "Stage SLA"),
    step(
      "D",
      "CreateEntity",
      { entity: "bus_capa", as: "newCapaId", fields: '{"owner_role":"owner"}' },
      "Open a CAPA"
    ),
    step(
      "E",
      "UpdateEntity",
      { entity: "bus_capa", targetSource: "newCapaId", field: "sla", source: "slaDays" },
      "Record the SLA"
    ),
  ];

  it("says who publishes each variable and who reads it", () => {
    const facts = analyzeVariables(flow, ["severity"]);
    const byName = Object.fromEntries(facts.map((fact) => [fact.name, fact]));

    expect(byName.owner).toMatchObject({ publishedBy: "Classify", usedBy: ["Open a CAPA"] });
    expect(byName.newCapaId).toMatchObject({
      publishedBy: "Open a CAPA",
      usedBy: ["Record the SLA"],
    });
    expect(byName.slaDays).toMatchObject({ publishedBy: "Stage SLA", usedBy: ["Record the SLA"] });
  });

  it("flags a variable nothing reads", () => {
    const facts = analyzeVariables(flow, ["severity"]);
    expect(facts.find((fact) => fact.name === "priority")?.problem).toBe("unused");
  });

  it("does not flag a column of the triggering record as missing", () => {
    const facts = analyzeVariables(flow, ["severity"]);
    expect(facts.find((fact) => fact.name === "severity")?.problem).toBeUndefined();
  });

  it("flags a read of a column the entity does not have", () => {
    const facts = analyzeVariables(flow, []);
    expect(facts.find((fact) => fact.name === "severity")?.problem).toBe("external");
  });

  it("catches a step reading a variable published after it", () => {
    const outOfOrder = [flow[3]!, flow[2]!];
    const facts = analyzeVariables(outOfOrder, []);
    expect(facts.find((fact) => fact.name === "newCapaId")?.problem).toBe("late");
  });

  it("does not report a literal in a create's column map as a missing variable", () => {
    // "open" is a status value, not a variable — flagging every such literal
    // buried the warnings that matter.
    const literals = [
      step("D", "CreateEntity", { entity: "bus_capa", fields: '{"status":"open"}' }, "Open a CAPA"),
    ];
    expect(analyzeVariables(literals, []).find((fact) => fact.name === "open")).toBeUndefined();
  });

  it("still records a create-map value that a previous step publishes", () => {
    const wired = [
      step("B", "Formula", { target: "capaTitle", operation: "set", value: "x" }, "Stage"),
      step("D", "CreateEntity", { entity: "bus_capa", fields: '{"title":"capaTitle"}' }, "Create"),
    ];
    expect(analyzeVariables(wired, []).find((fact) => fact.name === "capaTitle")).toMatchObject({
      publishedBy: "Stage",
      usedBy: ["Create"],
    });
  });

  it("still reports a source that nothing publishes", () => {
    const broken = [step("E", "UpdateEntity", { field: "x", source: "ghost" }, "Write")];
    expect(analyzeVariables(broken, []).find((fact) => fact.name === "ghost")?.problem).toBe(
      "external"
    );
  });

  it("lists publishers in the order they run", () => {
    const facts = analyzeVariables(flow, ["severity"]);
    const published = facts.filter((fact) => fact.publishedBy).map((fact) => fact.name);
    expect(published).toEqual(["priority", "owner", "slaDays", "newCapaId"]);
  });
});

describe("serializeDecisionTable", () => {
  it("fills every output cell, because a partial row is discarded silently", () => {
    const table: DecisionTable = {
      ...severityTable,
      rules: [{ _id: "r1", i1: '"major"', o1: "3" }],
    };
    const parsed = JSON.parse(serializeDecisionTable(table));
    expect(parsed.rules[0]).toEqual({ _id: "r1", i1: '"major"', o1: "3", o2: "''" });
  });

  it("round-trips", () => {
    const parsed = parseDecisionTable(serializeDecisionTable(severityTable));
    expect(parsed?.outputs.map((output) => output.field)).toEqual(["priority", "owner"]);
    expect(parsed?.hitPolicy).toBe("first");
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(parseDecisionTable("{ not json")).toBeNull();
    expect(parseDecisionTable(undefined)).toBeNull();
  });
});

describe("validateDecisionTable", () => {
  it("accepts a complete table", () => {
    expect(validateDecisionTable(severityTable)).toEqual([]);
  });

  it("names a column that publishes under no name", () => {
    const table = emptyDecisionTable();
    expect(validateDecisionTable(table).join(" ")).toContain("publishes under no name");
  });
});

describe("missingRequirements", () => {
  it("refuses a cross-entity update that names no row", () => {
    const props = { entity: "bus_capa", field: "status", value: "closed" };
    expect(missingRequirements(step("a", "UpdateEntity", props)).join(" ")).toContain("which row");
  });

  it("accepts one that does", () => {
    const props = { entity: "bus_capa", field: "status", value: "closed", targetSource: "capaId" };
    expect(missingRequirements(step("a", "UpdateEntity", props))).toEqual([]);
  });

  it("wants a decision to have a table or a rule", () => {
    expect(missingRequirements(step("a", "Decision", {})).join(" ")).toContain("decision table");
    expect(missingRequirements(step("a", "Decision", { rule: "Classify" }))).toEqual([]);
  });

  it("checks a formula against its own operation", () => {
    const set = step("a", "Formula", { target: "x", operation: "set" });
    expect(missingRequirements(set).join(" ")).toContain("a value to stage");

    const multiply = step("a", "Formula", { target: "x", operation: "multiply", source: "y" });
    expect(missingRequirements(multiply).join(" ")).toContain("operand");
  });
});
