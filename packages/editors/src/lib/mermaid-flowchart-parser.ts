// Minimal Mermaid flowchart TD → AST parser
// Supports: A([label]), B{label}, C[label], D((label)), edges with optional labels

export type NodeShape = "stadium" | "diamond" | "rect" | "circle" | "round";

export interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface FlowEdge {
  source: string;
  target: string;
  label?: string;
}

export interface FlowAST {
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
}

function parseNodeDef(id: string, rest: string): FlowNode | null {
  let m: RegExpMatchArray | null;

  m = rest.match(/^\(\[(.+?)\]\)/);
  if (m?.[1]) return { id, label: m[1].trim(), shape: "stadium" };

  m = rest.match(/^\(\((.+?)\)\)/);
  if (m?.[1]) return { id, label: m[1].trim(), shape: "circle" };

  m = rest.match(/^\{(.+?)\}/);
  if (m?.[1]) return { id, label: m[1].trim(), shape: "diamond" };

  m = rest.match(/^\[(.+?)\]/);
  if (m?.[1]) return { id, label: m[1].trim(), shape: "rect" };

  m = rest.match(/^\((.+?)\)/);
  if (m?.[1]) return { id, label: m[1].trim(), shape: "round" };

  return null;
}

function ensureNode(ast: FlowAST, id: string, suffix: string | undefined) {
  if (ast.nodes.has(id)) return;
  if (suffix) {
    const node = parseNodeDef(id, suffix);
    if (node) {
      ast.nodes.set(id, node);
      return;
    }
  }
  ast.nodes.set(id, { id, label: id, shape: "rect" });
}

// A node's shape suffix. Longest forms first: ((circle)) and ([stadium]) both
// start with "(", so a bare \([^)]*\) placed earlier would claim just their
// opening half and mis-shape the node.
const NODE_SUFFIX = String.raw`\(\([^)]*\)\)|\(\[[^\]]*\]\)|\{[^}]*\}|\[[^\]]*\]|\([^)]*\)`;

// Matches: SrcId[optional-suffix] --> |optional-label| TgtId[optional-suffix]
//
// The edge label is only recognized when it is actually delimited by pipes.
// Written as an optional unanchored group it matched the empty-pipe case by
// greedily consuming the target node, then backtracking just far enough to
// leave one identifier character behind — so "A --> B{Status == draft?}"
// produced a node id of "t" (the tail of "draft") instead of "B".
const EDGE_RE = new RegExp(
  String.raw`^([A-Za-z_][A-Za-z0-9_]*)(${NODE_SUFFIX})?\s*(?:-->|---)\s*(?:\|([^|]*)\|)?\s*([A-Za-z_][A-Za-z0-9_]*)(${NODE_SUFFIX})?`
);

export function parseMermaidFlowchart(code: string): FlowAST {
  const ast: FlowAST = { nodes: new Map(), edges: [] };

  for (const rawLine of code.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("flowchart") || line.startsWith("graph") || line.startsWith("%%"))
      continue;

    const em = line.match(EDGE_RE);
    if (em) {
      const [, srcId, srcSuffix, edgeLabel, tgtId, tgtSuffix] = em;
      if (!srcId || !tgtId) continue;

      ensureNode(ast, srcId, srcSuffix);
      ensureNode(ast, tgtId, tgtSuffix);

      ast.edges.push({
        source: srcId,
        target: tgtId,
        label: edgeLabel?.trim() || undefined,
      });
      continue;
    }

    // Standalone node definition
    const nm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(.+)$/);
    if (nm?.[1] && nm[2]) {
      const node = parseNodeDef(nm[1], nm[2].trim());
      if (node && !ast.nodes.has(nm[1])) ast.nodes.set(nm[1], node);
    }
  }

  return ast;
}
