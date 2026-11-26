import { describe, expect, it } from "vitest";
import { buildActionDecisionTable, parseRuleActions } from "../../../rules";
import { BunE2ETestGenerator } from "../bun-e2e.generator";

/**
 * The suites invent numbers. crm's `validation-error when: discount_percent > 40`
 * refuses every update to a record the factory gave 56, so a Quote CRUD run failed
 * for a random share of records. The ceiling is read off the compiled rule instead.
 */
function ceilingsFor(when: string) {
  const [action] = parseRuleActions(
    `%%action cap validation-error when: ${when} message: too much`
  );
  const jdmContent = JSON.stringify(buildActionDecisionTable("quote_cap", [action!]));
  const generator = new BunE2ETestGenerator({
    projectName: "t",
    projectVersion: "1",
    projectDescription: "",
    port: 1,
    frontendPort: 2,
    compiledRules: [
      {
        name: "quote_cap",
        tableName: "bus_quote",
        entity: "Quote",
        event: "beforeUpdate",
        operation: "UPDATE",
        priority: 1,
        jdmContent,
      },
    ],
  });
  const entities = [
    {
      name: "Quote",
      tableName: "bus_quote",
      attributes: [{ name: "discount_percent", columnName: "discount_percent" }],
    },
  ];
  const result = (
    generator as unknown as {
      withValueCeilings(e: unknown[]): Array<{ attributes: Array<{ maxValue?: number }> }>;
    }
  ).withValueCeilings(entities);
  return result[0]!.attributes[0]!.maxValue;
}

function refusalsFor(...whens: string[]) {
  const actions = whens.flatMap((when, index) =>
    parseRuleActions(`%%action r${index} validation-error when: ${when} message: no`)
  );
  const generator = new BunE2ETestGenerator({
    projectName: "t",
    projectVersion: "1",
    projectDescription: "",
    port: 1,
    frontendPort: 2,
    compiledRules: [
      {
        name: "r",
        tableName: "bus_payment",
        entity: "Payment",
        event: "beforeCreate",
        operation: "CREATE",
        priority: 1,
        jdmContent: JSON.stringify(buildActionDecisionTable("r", actions)),
      },
    ],
  });
  return (
    generator as unknown as { refusals(): Array<{ tableName: string; when: string }> }
  ).refusals();
}

describe("refusing conditions handed to the factory", () => {
  it("lists every validation-error condition with its table", () => {
    expect(refusalsFor("amount > balance_before", "amount <= 0")).toEqual([
      { tableName: "bus_payment", when: "amount > balance_before" },
      { tableName: "bus_payment", when: "amount <= 0" },
    ]);
  });

  it("keeps arithmetic and `today` conditions as written, for the factory to evaluate", () => {
    expect(refusalsFor("line_amount != quantity * unit_price", "due_on >= today")).toEqual([
      { tableName: "bus_payment", when: "line_amount != quantity * unit_price" },
      { tableName: "bus_payment", when: "due_on >= today" },
    ]);
  });

  it("leaves out an unconditional row, which refuses everything and says nothing about values", () => {
    expect(refusalsFor("true")).toEqual([]);
  });
});

describe("value ceilings from refusing rules", () => {
  it("keeps a value at or below a `>` bound", () => {
    expect(ceilingsFor("discount_percent > 40")).toBe(40);
  });

  it("keeps a value strictly below a `>=` bound", () => {
    expect(ceilingsFor("discount_percent >= 40")).toBeCloseTo(39.99, 5);
  });

  it("claims no ceiling for a condition it cannot read", () => {
    expect(ceilingsFor('status == "withdrawn" and discount_percent > 40')).toBeUndefined();
  });
});
