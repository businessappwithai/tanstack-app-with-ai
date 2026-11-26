import { describe, expect, it } from "vitest";
import type { DecisionTable } from "../../../lib/workflow/bpmn-model";
import { checkCoverage, evaluateTable } from "../RuleTableEditor";

/**
 * The discount table the builder was designed around.
 *
 * Read top to bottom, first row that fits wins, with a catch-all last so it
 * always returns an answer.
 */
function discountTier(): DecisionTable {
  return {
    hitPolicy: "first",
    inputs: [
      { id: "i1", name: "Tier", field: "Customer.tier" },
      { id: "i2", name: "Total", field: "Order.total" },
    ],
    outputs: [
      { id: "o1", name: "Discount", field: "discount_pct" },
      { id: "o2", name: "Approval", field: "approval_required" },
    ],
    rules: [
      { _id: "r1", i1: '= "platinum"', i2: "> 5000", o1: "20", o2: "false" },
      { _id: "r2", i1: '= "platinum"', i2: "", o1: "15", o2: "false" },
      { _id: "r3", i1: '= "gold"', i2: "> 1000", o1: "10", o2: "false" },
      { _id: "r4", i1: "", i2: "> 10000", o1: "5", o2: "true" },
      { _id: "r5", i1: "", i2: "", o1: "0", o2: "false" },
    ],
  };
}

describe("evaluateTable", () => {
  it("returns the first row that fits, not the best one", () => {
    const result = evaluateTable(discountTier(), {
      "Customer.tier": "platinum",
      "Order.total": "9000",
    });
    // Row 2 also fits, but row 1 is higher and wins.
    expect(result.rowIndex).toBe(0);
    expect(result.outputs).toEqual({ discount_pct: "20", approval_required: "false" });
  });

  it("treats a blank check as 'any'", () => {
    const result = evaluateTable(discountTier(), {
      "Customer.tier": "platinum",
      "Order.total": "50",
    });
    expect(result.rowIndex).toBe(1);
    expect(result.outputs.discount_pct).toBe("15");
  });

  it("compares numbers numerically, not as text", () => {
    // As text, "900" > "1000" is true. As numbers it is false, and row 3 must not fit.
    const result = evaluateTable(discountTier(), {
      "Customer.tier": "gold",
      "Order.total": "900",
    });
    expect(result.rowIndex).toBe(4);
    expect(result.outputs.discount_pct).toBe("0");
  });

  it("matches the documented worked example", () => {
    const result = evaluateTable(discountTier(), {
      "Customer.tier": "gold",
      "Order.total": "2400",
    });
    expect(result.rowIndex).toBe(2);
    expect(result.outputs).toEqual({ discount_pct: "10", approval_required: "false" });
  });

  it("falls through to the catch-all when nothing else fits", () => {
    const result = evaluateTable(discountTier(), {
      "Customer.tier": "bronze",
      "Order.total": "10",
    });
    expect(result.rowIndex).toBe(4);
  });

  it("reports no match when a table has no catch-all", () => {
    const table = discountTier();
    table.rules = table.rules.slice(0, 1);
    const result = evaluateTable(table, { "Customer.tier": "bronze", "Order.total": "10" });
    expect(result.rowIndex).toBeNull();
    expect(result.outputs).toEqual({});
  });

  it("understands each comparison operator", () => {
    const cases: [string, string, boolean][] = [
      ["> 10", "11", true],
      ["> 10", "10", false],
      [">= 10", "10", true],
      ["< 10", "9", true],
      ["<= 10", "10", true],
      ["!= 10", "11", true],
      ["!= 10", "10", false],
      ["= 10", "10", true],
    ];
    for (const [cell, value, expected] of cases) {
      const table: DecisionTable = {
        hitPolicy: "first",
        inputs: [{ id: "i1", name: "N", field: "n" }],
        outputs: [{ id: "o1", name: "Out", field: "out" }],
        rules: [{ _id: "r1", i1: cell, o1: "yes" }],
      };
      expect(evaluateTable(table, { n: value }).rowIndex === 0).toBe(expected);
    }
  });

  it("compares unquoted and quoted text the same way", () => {
    const table: DecisionTable = {
      hitPolicy: "first",
      inputs: [{ id: "i1", name: "S", field: "s" }],
      outputs: [{ id: "o1", name: "Out", field: "out" }],
      rules: [
        { _id: "r1", i1: '"gold"', o1: "quoted" },
        { _id: "r2", i1: "gold", o1: "bare" },
      ],
    };
    expect(evaluateTable(table, { s: "gold" }).outputs.out).toBe("quoted");
  });

  it("does not match a numeric comparison against text", () => {
    const table: DecisionTable = {
      hitPolicy: "first",
      inputs: [{ id: "i1", name: "N", field: "n" }],
      outputs: [{ id: "o1", name: "Out", field: "out" }],
      rules: [{ _id: "r1", i1: "> 10", o1: "yes" }],
    };
    expect(evaluateTable(table, { n: "abc" }).rowIndex).toBeNull();
  });
});

describe("checkCoverage", () => {
  it("confirms no gaps when a catch-all is present", () => {
    const notes = checkCoverage(discountTier());
    expect(notes[0]).toMatchObject({ level: "ok" });
    expect(notes[0]?.message).toMatch(/no gaps/i);
  });

  it("warns when there is no catch-all, because the step then produces nothing", () => {
    const table = discountTier();
    table.rules = table.rules.slice(0, 3);
    const notes = checkCoverage(table);
    expect(notes[0]?.level).toBe("warn");
    expect(notes[0]?.message).toMatch(/catch-all/i);
  });

  it("names a row an earlier row already shadows", () => {
    const table: DecisionTable = {
      hitPolicy: "first",
      inputs: [{ id: "i1", name: "Tier", field: "tier" }],
      outputs: [{ id: "o1", name: "Out", field: "out" }],
      rules: [
        { _id: "r1", i1: "", o1: "catch-all first" },
        { _id: "r2", i1: '= "gold"', o1: "never reached" },
      ],
    };
    const shadow = checkCoverage(table).find((n) => /can never fire/.test(n.message));
    expect(shadow?.message).toContain("Row 1");
    expect(shadow?.message).toContain("row 2");
  });

  it("does not call a correctly ordered table shadowed", () => {
    const shadowNotes = checkCoverage(discountTier()).filter((n) =>
      /can never fire/.test(n.message)
    );
    expect(shadowNotes).toHaveLength(0);
  });
});
