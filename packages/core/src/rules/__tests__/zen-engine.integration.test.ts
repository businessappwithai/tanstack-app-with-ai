/**
 * Zen Engine Integration Tests
 *
 * Tests for zen-engine integration with real JDM evaluation.
 * Verifies correct behavior, error handling, and performance.
 *
 * JDM format reference: see generated-projects/hospital-swiss-clean-new/backend/src/modules/rules/jdm/
 *
 * Created by: TEST-001 ticket
 * Week: 5
 */

import { describe, expect, it } from "vitest";
import { zenEngine } from "../zen-engine.singleton";

/**
 * Simple age validation decision table.
 * Uses zen-engine's expected JDM format with inputNode/decisionTableNode/outputNode
 * and flat rule objects where keys are input/output IDs and values are expressions.
 */
const simpleDecisionTableJDM = {
  nodes: [
    {
      id: "input",
      type: "inputNode",
      name: "Input",
      position: { x: 0, y: 0 },
    },
    {
      id: "age_check",
      type: "decisionTableNode",
      name: "Age Validation",
      position: { x: 300, y: 0 },
      content: {
        hitPolicy: "first",
        inputs: [{ id: "i1", name: "Age", field: "age" }],
        outputs: [{ id: "o1", name: "Allowed", field: "allowed" }],
        rules: [
          { _id: "adult", i1: ">= 18", o1: "true" },
          { _id: "minor", i1: "< 18", o1: "false" },
        ],
      },
    },
    {
      id: "output",
      type: "outputNode",
      name: "Output",
      position: { x: 600, y: 0 },
    },
  ],
  edges: [
    { id: "e1", sourceId: "input", targetId: "age_check" },
    { id: "e2", sourceId: "age_check", targetId: "output" },
  ],
};

/**
 * JDM with priority-based rules for risk assessment.
 */
const priorityRulesJDM = {
  nodes: [
    {
      id: "input",
      type: "inputNode",
      name: "Input",
      position: { x: 0, y: 0 },
    },
    {
      id: "risk_check",
      type: "decisionTableNode",
      name: "Risk Assessment",
      position: { x: 300, y: 0 },
      content: {
        hitPolicy: "first",
        inputs: [
          { id: "i1", name: "Risk", field: "risk" },
          { id: "i2", name: "Amount", field: "amount" },
        ],
        outputs: [
          { id: "o1", name: "Approved", field: "approved" },
          { id: "o2", name: "Reason", field: "reason" },
        ],
        rules: [
          {
            _id: "high-risk-limit",
            i1: "== 'high'",
            i2: "> 1000",
            o1: "false",
            o2: '"High risk amount exceeds limit"',
          },
          {
            _id: "standard-limit",
            i1: "",
            i2: "<= 5000",
            o1: "true",
            o2: '"Within standard limit"',
          },
          {
            _id: "over-limit",
            i1: "",
            i2: "> 5000",
            o1: "false",
            o2: '"Exceeds standard limit"',
          },
        ],
      },
    },
    {
      id: "output",
      type: "outputNode",
      name: "Output",
      position: { x: 600, y: 0 },
    },
  ],
  edges: [
    { id: "e1", sourceId: "input", targetId: "risk_check" },
    { id: "e2", sourceId: "risk_check", targetId: "output" },
  ],
};

/**
 * Invalid JDM (malformed node type)
 */
const invalidJDM = {
  nodes: [
    {
      id: "bad_node",
      type: "invalid_type",
      name: "Invalid Node",
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

describe("Zen Engine Integration", () => {
  describe("Simple decision table evaluation", () => {
    it("should evaluate age >= 18 as allowed", async () => {
      const result = await zenEngine.evaluate(simpleDecisionTableJDM, {
        age: 25,
      });

      expect(result.success).toBe(true);
      expect(result.decision?.result).toEqual({ allowed: true });
    });

    it("should evaluate age < 18 as not allowed", async () => {
      const result = await zenEngine.evaluate(simpleDecisionTableJDM, {
        age: 15,
      });

      expect(result.success).toBe(true);
      expect(result.decision?.result).toEqual({ allowed: false });
    });

    it("should execute in under 100ms", async () => {
      const start = Date.now();

      await zenEngine.evaluate(simpleDecisionTableJDM, {
        age: 30,
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Missing required field handling", () => {
    it("should handle missing input gracefully", async () => {
      const result = await zenEngine.evaluate(simpleDecisionTableJDM, {
        // Missing 'age' field - zen-engine evaluates with undefined
      });

      // Zen-engine should still complete successfully
      expect(result.success).toBe(true);
      expect(result.decision).toBeDefined();
    });
  });

  describe("Multiple rules with priority", () => {
    it("should evaluate high-risk rule correctly", async () => {
      const result = await zenEngine.evaluate(priorityRulesJDM, {
        risk: "high",
        amount: 2000,
      });

      expect(result.success).toBe(true);
      expect(result.decision?.result).toEqual({
        approved: false,
        reason: "High risk amount exceeds limit",
      });
    });

    it("should fall through to low-priority rule", async () => {
      const result = await zenEngine.evaluate(priorityRulesJDM, {
        risk: "low",
        amount: 3000,
      });

      expect(result.success).toBe(true);
      expect(result.decision?.result).toEqual({
        approved: true,
        reason: "Within standard limit",
      });
    });
  });

  describe("Invalid JDM handling", () => {
    it("should throw error for invalid JDM structure", async () => {
      const result = await zenEngine.evaluate(invalidJDM, {});

      // Zen-engine should fail on invalid JDM
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBeDefined();
    });
  });

  describe("A record the Record node's schema refuses", () => {
    const graph = {
      nodes: [
        {
          id: "in",
          type: "inputNode",
          name: "Record",
          position: { x: 0, y: 0 },
          content: {
            schema: JSON.stringify({
              type: "object",
              properties: { status: { type: "string" } },
            }),
          },
        },
        { id: "out", type: "outputNode", name: "Response", position: { x: 1, y: 0 }, content: {} },
      ],
      edges: [{ id: "e", sourceId: "in", targetId: "out", type: "edge" }],
    };

    it("says which field failed, not that the graph is invalid", async () => {
      const result = await zenEngine.evaluate(graph as never, { status: null });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("/status");
      expect(result.error?.message).not.toContain("invalid JDM structure");
    });
  });

  describe("Performance tests", () => {
    it("should complete 10 evaluations in under 1 second", async () => {
      const start = Date.now();

      const promises = Array.from({ length: 10 }, (_, i) =>
        zenEngine.evaluate(simpleDecisionTableJDM, {
          age: 20 + i,
        })
      );

      await Promise.all(promises);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });

    it("should handle timeout correctly", async () => {
      const startTime = Date.now();

      const result = await zenEngine.evaluate(
        simpleDecisionTableJDM,
        { age: 25 },
        { timeout: 5000 }
      );

      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000);
    });
  });
});
