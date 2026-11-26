import { describe, expect, it } from "vitest";
import { entityForService, firstRuleOn, rulesForEntity } from "../service-entity";

describe("entityForService", () => {
  it("drops the trailing Service and nothing else", () => {
    expect(entityForService("CompoundService")).toBe("Compound");
    expect(entityForService("ServiceTicketService")).toBe("ServiceTicket");
    expect(entityForService("CustomerServiceService")).toBe("CustomerService");
  });
});

describe("rulesForEntity", () => {
  const rules = [
    { name: "a", entity: "Experiment" },
    { name: "b", entity: "Compound" },
    { name: "c", entity: "Program" },
    { name: "d", entity: "Compound" },
  ];

  it("lists the page's entity's rules with their index into the whole list", () => {
    expect(rulesForEntity(rules, "Compound", -1)).toEqual([
      { rule: rules[1], index: 1 },
      { rule: rules[3], index: 3 },
    ]);
  });

  it("keeps the open rule listed after it is moved to another entity", () => {
    expect(rulesForEntity(rules, "Compound", 2).map(({ index }) => index)).toEqual([1, 2, 3]);
  });

  it("finds the first rule on the entity, or -1", () => {
    expect(firstRuleOn(rules, "Compound")).toBe(1);
    expect(firstRuleOn(rules, "Sample")).toBe(-1);
  });
});
