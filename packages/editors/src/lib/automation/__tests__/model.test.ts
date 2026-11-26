import { describe, expect, it } from "vitest";
import {
  type Automation,
  emptyAutomation,
  newCondition,
  newHook,
  newStep,
  parseAutomation,
  serializeAutomation,
  validateAutomation,
  valuesAvailableAt,
} from "../model";

/**
 * A realistic automation: the one the builder was designed around.
 *
 * "When an Order is created, only if Order.total is greater than 1000, then
 * look up a rule table, set a field, and create an Invoice."
 */
function sampleAutomation(): Automation {
  const a = emptyAutomation("Order");
  a.name = "Order fulfilment";
  a.trigger = { entity: "Order", event: "created" };

  a.conditions = [{ ...newCondition(), field: "order.total", operator: "gt", value: "1000" }];

  const decision = newStep("Decision");
  decision.resultName = "tier";
  decision.props = { ruleTable: "Discount tier" };

  const update = newStep("UpdateEntity");
  update.resultName = "";
  update.props = { entity: "Order", field: "priority", value: "high" };

  const create = newStep("CreateEntity");
  create.resultName = "invoiceId";
  create.props = { entity: "Invoice" };

  a.steps = [decision, update, create];
  return a;
}

describe("serializeAutomation / parseAutomation", () => {
  it("round-trips the trigger, checks and steps", () => {
    const original = sampleAutomation();
    const reopened = parseAutomation(serializeAutomation(original), "Order");

    expect(reopened.name).toBe("Order fulfilment");
    expect(reopened.trigger).toEqual({ entity: "Order", event: "created" });

    expect(reopened.conditions).toHaveLength(1);
    expect(reopened.conditions[0]).toMatchObject({
      field: "order.total",
      operator: "gt",
      value: "1000",
    });

    expect(reopened.steps.map((s) => s.type)).toEqual(["Decision", "UpdateEntity", "CreateEntity"]);
    expect(reopened.steps.map((s) => s.resultName)).toEqual(["tier", "", "invoiceId"]);
    expect(reopened.steps[0]?.props.ruleTable).toBe("Discount tier");
    expect(reopened.steps[1]?.props).toMatchObject({
      entity: "Order",
      field: "priority",
      value: "high",
    });
  });

  it("keeps step order, because order is the whole semantics", () => {
    const original = sampleAutomation();
    const reopened = parseAutomation(serializeAutomation(original), "Order");
    expect(reopened.steps.map((s) => s.props.entity ?? s.props.ruleTable)).toEqual([
      "Discount tier",
      "Order",
      "Invoice",
    ]);
  });

  it("survives a second round-trip unchanged", () => {
    const once = serializeAutomation(sampleAutomation());
    const twice = serializeAutomation(parseAutomation(once, "Order"));
    expect(twice).toBe(once);
  });

  it("emits valid mermaid — a flowchart header and a connected chain", () => {
    const source = serializeAutomation(sampleAutomation());
    expect(source.split("\n")[0]).toBe("flowchart TD");
    expect(source).toContain("start([Order is created])");
    expect(source).toContain("--> done");
  });

  it("maps every trigger event back to the event it came from", () => {
    for (const event of [
      "created",
      "beforeCreated",
      "updated",
      "beforeUpdated",
      "deleted",
      "beforeDeleted",
    ] as const) {
      const a = emptyAutomation("Order");
      a.trigger = { entity: "Order", event };
      expect(parseAutomation(serializeAutomation(a), "Order").trigger.event).toBe(event);
    }
  });

  it("drops a step it cannot read rather than inventing one", () => {
    const reopened = parseAutomation(
      ["flowchart TD", "%%hook afterCreate on Order", "  s1[Mystery]", "  start --> s1"].join("\n"),
      "Order"
    );
    expect(reopened.steps).toHaveLength(0);
    expect(reopened.trigger.entity).toBe("Order");
  });

  it("keeps a check whose value is not quoted JSON", () => {
    const reopened = parseAutomation(
      ["flowchart TD", "%%hook afterCreate on Order", "%%guard order.status eq confirmed"].join(
        "\n"
      ),
      "Order"
    );
    expect(reopened.conditions[0]).toMatchObject({
      field: "order.status",
      operator: "eq",
      value: "confirmed",
    });
  });

  it("falls back to the given entity when the source names none", () => {
    expect(parseAutomation("flowchart TD", "Patient").trigger.entity).toBe("Patient");
  });
});

describe("valuesAvailableAt", () => {
  const fields = { Order: ["id", "total", "status"] };

  it("offers the trigger record's fields to the first step", () => {
    const available = valuesAvailableAt(sampleAutomation(), 0, fields);
    expect(available.map((v) => v.path)).toEqual(["order.id", "order.total", "order.status"]);
  });

  it("never offers a step's own result to itself", () => {
    const a = sampleAutomation();
    const paths = valuesAvailableAt(a, 0, fields).map((v) => v.path);
    expect(paths).not.toContain("tier");
  });

  it("offers an earlier step's result to a later one", () => {
    const a = sampleAutomation();
    const paths = valuesAvailableAt(a, 2, fields).map((v) => v.path);
    expect(paths).toContain("tier");
  });

  it("never offers a later step's result to an earlier one", () => {
    const a = sampleAutomation();
    const paths = valuesAvailableAt(a, 1, fields).map((v) => v.path);
    expect(paths).not.toContain("invoiceId");
  });

  it("skips steps that name no result", () => {
    const a = sampleAutomation();
    const paths = valuesAvailableAt(a, 3, fields).map((v) => v.path);
    expect(paths).toContain("tier");
    expect(paths).toContain("invoiceId");
    expect(paths).toHaveLength(5);
  });

  it("expands a rule table step into one path per outcome", () => {
    const a = sampleAutomation();
    const decision = a.steps[0];
    if (!decision) throw new Error("fixture lost its decision step");
    decision.table = {
      hitPolicy: "first",
      inputs: [],
      outputs: [
        { id: "o1", name: "Discount", field: "discount_pct" },
        { id: "o2", name: "Approval", field: "approval_required" },
      ],
      rules: [],
    };
    const paths = valuesAvailableAt(a, 1, fields).map((v) => v.path);
    expect(paths).toContain("tier.discount_pct");
    expect(paths).toContain("tier.approval_required");
  });
});

describe("validateAutomation", () => {
  it("passes a complete automation", () => {
    expect(validateAutomation(sampleAutomation())).toEqual([]);
  });

  it("asks for at least one thing to do", () => {
    const a = sampleAutomation();
    a.steps = [];
    expect(validateAutomation(a).map((p) => p.target)).toContain("steps");
  });

  it("names the check that has no field", () => {
    const a = sampleAutomation();
    const check = a.conditions[0];
    if (!check) throw new Error("fixture lost its check");
    check.field = "";
    const problem = validateAutomation(a).find((p) => p.target === check.id);
    expect(problem?.message).toMatch(/which field/i);
  });

  it("wants a value for an operator that takes one", () => {
    const a = sampleAutomation();
    const check = a.conditions[0];
    if (!check) throw new Error("fixture lost its check");
    check.value = "";
    expect(validateAutomation(a).find((p) => p.target === check.id)?.message).toMatch(
      /needs a value/i
    );
  });

  it("does not want a value for an operator that takes none", () => {
    const a = sampleAutomation();
    const check = a.conditions[0];
    if (!check) throw new Error("fixture lost its check");
    check.operator = "isEmpty";
    check.value = "";
    expect(validateAutomation(a).some((p) => p.target === check.id)).toBe(false);
  });

  it("catches two steps saving their answer under the same name", () => {
    const a = sampleAutomation();
    const [decision, , create] = a.steps;
    if (!decision || !create) throw new Error("fixture lost a step");
    create.resultName = decision.resultName;
    expect(validateAutomation(a).find((p) => p.target === create.id)?.message).toMatch(
      /both save their answer/i
    );
  });

  it("names the step and what it is missing", () => {
    const a = sampleAutomation();
    const decision = a.steps[0];
    if (!decision) throw new Error("fixture lost its decision step");
    decision.props = {};
    expect(validateAutomation(a).find((p) => p.target === decision.id)?.message).toBe(
      "Step 1 is missing a rule table to look up."
    );
  });

  /**
   * A Formula's single value compiles by its kind: a reference to `source`, text
   * to `value`. "set" reads only `value` and "copy" only `source`, so the wrong
   * kind passed here saved, then failed the checker (EML262) and generation.
   */
  it.each([
    ["set", "{{order.total}}", /choose "copy"/],
    ["copy", "high", /choose "set"/],
  ])("refuses %s given the other kind of value (%s)", (operation, left, message) => {
    const a = sampleAutomation();
    const formula = newStep("Formula");
    formula.props = { operation, left };
    a.steps.push(formula);
    expect(validateAutomation(a).find((p) => p.target === formula.id)?.message).toMatch(message);
  });

  it.each([
    ["set", "high"],
    ["copy", "{{order.total}}"],
  ])("accepts %s given its own kind of value (%s)", (operation, left) => {
    const a = sampleAutomation();
    const formula = newStep("Formula");
    formula.props = { operation, left };
    a.steps.push(formula);
    expect(validateAutomation(a).some((p) => p.target === formula.id)).toBe(false);
  });

  it("asks for a name and a record type on a fresh automation", () => {
    const a = emptyAutomation("");
    a.name = "";
    const targets = validateAutomation(a).map((p) => p.target);
    expect(targets).toContain("name");
    expect(targets).toContain("trigger");
  });
});

/**
 * A hook is its own workflow: one handler, and the steps that follow it. The
 * builder used to stop at the rungs and the serializer dropped steps, so an
 * author could add them and watch them vanish on save.
 */
describe("a hook workflow carries its own steps", () => {
  function hookWorkflow(): Automation {
    const a = emptyAutomation("Course", "hook");
    a.name = "beforeUpdateCourse";
    a.trigger = { entity: "Course", event: "created" };
    a.hooks = [newHook("beforeUpdate")];
    const hook = a.hooks[0];
    if (hook) hook.handler = "beforeUpdateCourse";

    const update = newStep("UpdateEntity");
    update.props = { entity: "Course", field: "status", value: "published" };
    a.steps = [update];
    a.conditions = [{ ...newCondition(), field: "course.status", operator: "eq", value: "draft" }];
    return a;
  }

  it("keeps the handler and the steps through a round trip", () => {
    const reopened = parseAutomation(serializeAutomation(hookWorkflow()), "Course");
    expect(reopened.kind).toBe("hook");
    expect(reopened.hooks.map((h) => `${h.event}:${h.handler}`)).toEqual([
      "beforeUpdate:beforeUpdateCourse",
    ]);
    expect(reopened.steps).toHaveLength(1);
    expect(reopened.steps[0]?.props).toMatchObject({ field: "status", value: "published" });
    expect(reopened.conditions[0]).toMatchObject({ field: "course.status", value: "draft" });
  });

  it("does not require steps on a hook that only has handlers", () => {
    const a = emptyAutomation("Course", "hook");
    a.name = "beforeCreateCourse";
    a.hooks = [newHook("beforeCreate")];
    const hook = a.hooks[0];
    if (hook) hook.handler = "beforeCreateCourse";
    a.steps = [];
    expect(validateAutomation(a).filter((p) => p.target === "steps")).toEqual([]);
  });

  it("still validates the steps a hook does carry", () => {
    const a = hookWorkflow();
    const step = a.steps[0];
    if (!step) throw new Error("fixture lost its step");
    step.props = { entity: "Course" };
    expect(validateAutomation(a).some((p) => p.target === step.id)).toBe(true);
  });
});
