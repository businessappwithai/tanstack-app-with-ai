/**
 * Every node of every rule the CRM model compiles can be drawn.
 *
 * Thirteen of the CRM's thirty rules are compiled from `%%rule` flowcharts into
 * GoRules graphs with no node positions; opening one in Rules and workflows
 * threw "Cannot read properties of undefined (reading 'x')" from the canvas and
 * took the screen down. `withNodePositions` is what the editor runs a graph
 * through before drawing it (GoRulesEditorPanel).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileRules } from "../../../../../generator/src/rules";
import { extractRuleSections } from "../../../../../generator/src/eml";
import { withNodePositions } from "../graph-layout";

const CRM = readFileSync(
  join(import.meta.dirname, "../../../../../../language/examples/crm.eml.mmd"),
  "utf8"
);

type Node = { id: string; position?: { x: number; y: number } };
const placed = (node: Node) =>
  Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y);

describe("placing a decision graph's nodes", () => {
  const rules = compileRules(extractRuleSections(CRM));
  const graphs = rules.map((rule) => ({
    name: rule.name,
    graph: JSON.parse(rule.jdmContent) as { nodes: Node[]; edges: never[] },
  }));

  it("finds the CRM's compiled rules, some of them without positions", () => {
    expect(graphs.length).toBeGreaterThan(5);
    expect(graphs.some(({ graph }) => graph.nodes?.some((node) => !placed(node)))).toBe(true);
  });

  it("gives every node of every CRM rule a place", () => {
    for (const { name, graph } of graphs) {
      const laid = withNodePositions(graph);
      expect(laid.nodes.every(placed), String(name)).toBe(true);
    }
  });

  it("lays a graph out left to right along its edges", () => {
    const laid = withNodePositions({
      nodes: [{ id: "c" }, { id: "a" }, { id: "b" }, { id: "d" }],
      edges: [
        { sourceId: "a", targetId: "b" },
        { sourceId: "b", targetId: "c" },
        { sourceId: "a", targetId: "d" },
      ],
    } as { nodes: Node[]; edges: { sourceId: string; targetId: string }[] });
    const x = Object.fromEntries(laid.nodes.map((node) => [node.id, node.position!.x]));
    expect(x.a).toBeLessThan(x.b!);
    expect(x.b).toBeLessThan(x.c!);
    expect(x.d).toBe(x.b);
    const y = Object.fromEntries(laid.nodes.map((node) => [node.id, node.position!.y]));
    expect(y.b).not.toBe(y.d);
  });

  it("keeps a position an author gave, and leaves a placed graph untouched", () => {
    const authored = { nodes: [{ id: "a", position: { x: 5, y: 7 } }], edges: [] };
    expect(withNodePositions(authored)).toBe(authored);
    const mixed = withNodePositions({
      nodes: [{ id: "a", position: { x: 5, y: 7 } }, { id: "b" }],
      edges: [{ sourceId: "a", targetId: "b" }],
    } as { nodes: Node[]; edges: { sourceId: string; targetId: string }[] });
    expect(mixed.nodes[0]!.position).toEqual({ x: 5, y: 7 });
    expect(placed(mixed.nodes[1]!)).toBe(true);
  });

  it("survives a cycle", () => {
    const laid = withNodePositions({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { sourceId: "a", targetId: "b" },
        { sourceId: "b", targetId: "a" },
      ],
    } as { nodes: Node[]; edges: { sourceId: string; targetId: string }[] });
    expect(laid.nodes.every(placed)).toBe(true);
  });
});
