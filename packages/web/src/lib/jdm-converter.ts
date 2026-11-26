// Converts a parsed Mermaid flowchart AST → GoRules JDM JSON
// Minimal, no AI required.

import type { FlowAST, NodeShape } from "@appwithai/editors/lib/mermaid-flowchart-parser";

type JdmNodeType = "inputNode" | "outputNode" | "switchNode" | "expressionNode" | "functionNode";

interface JdmNode {
  id: string;
  name: string;
  type: JdmNodeType;
}

interface JdmEdge {
  id: string;
  name?: string;
  sourceId: string;
  targetId: string;
}

export interface JdmGraph {
  nodes: JdmNode[];
  edges: JdmEdge[];
}

function shapeToType(shape: NodeShape, isTarget: boolean, isSource: boolean): JdmNodeType {
  if (shape === "stadium") return isTarget && !isSource ? "outputNode" : "inputNode";
  if (shape === "diamond") return "switchNode";
  if (shape === "circle") return "functionNode";
  return "expressionNode";
}

export function convertToJdm(ast: FlowAST): JdmGraph {
  const sourceIds = new Set(ast.edges.map((e) => e.source));
  const targetIds = new Set(ast.edges.map((e) => e.target));

  const nodes: JdmNode[] = [];
  let edgeCounter = 0;

  for (const [, node] of ast.nodes) {
    const isSource = sourceIds.has(node.id);
    const isTarget = targetIds.has(node.id);
    nodes.push({
      id: `node-${node.id}`,
      name: node.label,
      type: shapeToType(node.shape, isTarget, isSource),
    });
  }

  const edges: JdmEdge[] = ast.edges.map((e) => ({
    id: `edge-${++edgeCounter}`,
    name: e.label,
    sourceId: `node-${e.source}`,
    targetId: `node-${e.target}`,
  }));

  return { nodes, edges };
}
