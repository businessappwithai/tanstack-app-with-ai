import { describe, expect, it } from "vitest";
import { parseMermaidFlowchart } from "../mermaid-flowchart-parser";

// Regression: ISSUE-005 — nodes first declared on the right-hand side of an
// arrow were parsed as a one-character id taken from the tail of their label,
// so "A --> B{Status == draft?}" yielded a node "t" and left B unlabeled. The
// bad ids flowed straight into the GoRules JDM export on the Rules step.
// Found by /qa on 2026-07-30
// Report: .gstack/qa-reports/qa-report-localhost-3000-2026-07-30.md

describe("parseMermaidFlowchart", () => {
  it("labels a node declared on the right-hand side of an edge", () => {
    const ast = parseMermaidFlowchart(`flowchart TD
    A([Start: Submit Requested]) --> B{Status == draft?}`);

    expect([...ast.nodes.keys()].sort()).toEqual(["A", "B"]);
    expect(ast.nodes.get("B")).toEqual({
      id: "B",
      label: "Status == draft?",
      shape: "diamond",
    });
    expect(ast.edges).toEqual([{ source: "A", target: "B", label: undefined }]);
  });

  it("does not invent nodes from label tails", () => {
    const ast = parseMermaidFlowchart(`flowchart TD
    X1 --> Z([End])`);

    expect([...ast.nodes.keys()].sort()).toEqual(["X1", "Z"]);
    expect(ast.nodes.get("Z")?.label).toBe("End");
  });

  it("still reads pipe-delimited edge labels", () => {
    const ast = parseMermaidFlowchart(`flowchart TD
    B -->|No| X1[Reject: Not in Draft]`);

    expect(ast.edges).toEqual([{ source: "B", target: "X1", label: "No" }]);
    expect(ast.nodes.get("X1")?.label).toBe("Reject: Not in Draft");
  });

  // ([stadium]) and ((circle)) both open with "(", so suffix alternation order
  // decides whether the shape is read whole or clipped to its opening half.
  it("distinguishes circle from stadium", () => {
    const ast = parseMermaidFlowchart(`flowchart TD
    A([stadium]) --> B((circle))`);

    expect(ast.nodes.get("A")?.shape).toBe("stadium");
    expect(ast.nodes.get("A")?.label).toBe("stadium");
    expect(ast.nodes.get("B")?.shape).toBe("circle");
    expect(ast.nodes.get("B")?.label).toBe("circle");
  });

  it("parses the drug-discovery submission gate into exactly its 11 nodes", () => {
    const ast = parseMermaidFlowchart(`flowchart TD
    A([Start: Submit Requested]) --> B{Status == draft?}
    B -->|No| X1[Reject: Not in Draft]
    B -->|Yes| C{Title provided?}
    C -->|No| X2[Reject: Title Required]
    C -->|Yes| D{PI assigned?}
    D -->|No| X3[Reject: PI Required]
    D -->|Yes| E{Estimated duration >= 1?}
    E -->|No| X4[Reject: Duration Required]
    E -->|Yes| P[Set status: submitted]
    X1 --> Z([End])
    X2 --> Z
    X3 --> Z
    X4 --> Z
    P --> Z`);

    expect([...ast.nodes.keys()].sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "P",
      "X1",
      "X2",
      "X3",
      "X4",
      "Z",
    ]);
    // Every node carries its declared label, not its bare id.
    for (const node of ast.nodes.values()) {
      expect(node.label).not.toBe(node.id);
    }
    expect(ast.edges).toHaveLength(14);
  });
});
