import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildModelLogic, renderModelLogic } from "../model-logic";

const DANCE = readFileSync(
  path.resolve(__dirname, "../../../../../tests/test-data/dance-studio-workflows.eml.mmd"),
  "utf8"
);

describe("the model's workflows, as the generated screen shows them", () => {
  const workflows = buildModelLogic(DANCE);

  it("carries every kind the model declares, each with the diagram that was drawn", () => {
    expect(workflows.length).toBeGreaterThan(0);
    const kinds = new Set(workflows.map((workflow) => workflow.kind));
    expect(kinds.has("saga")).toBe(true);
    for (const workflow of workflows) {
      expect(workflow.name).toBeTruthy();
      expect(workflow.entity).toBeTruthy();
      expect(workflow.diagram).toMatch(/^(flowchart|graph|stateDiagram)/);
    }
  });

  it("keeps how a saga starts", () => {
    const rule = workflows.find(
      (workflow) => workflow.kind === "saga" && workflow.trigger === "rule"
    );
    expect(rule, "a saga that only a rule starts").toBeTruthy();
  });

  it("reads several documents as one", () => {
    expect(buildModelLogic([DANCE, ""]).length).toBe(workflows.length);
    expect(buildModelLogic("")).toEqual([]);
  });

  it("renders a module the front end can import", () => {
    const text = renderModelLogic(workflows);
    expect(text).toContain("export const MODEL_WORKFLOWS: ModelWorkflow[] = [");
    expect(text).toContain(JSON.stringify(workflows[0]?.name));
  });
});
