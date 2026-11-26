/**
 * Somewhere to draw every node of a decision graph.
 *
 * A rule compiled from a model's `%%rule` flowchart is a GoRules graph whose
 * nodes carry no `position`: the rules engine evaluates nodes and edges and has
 * no use for coordinates, so the compiler writes none. The graph editor does —
 * React Flow reads `node.position.x` for every node — and opening such a rule
 * threw "Cannot read properties of undefined (reading 'x')" and took the whole
 * Rules and workflows screen down with it. Thirteen of the CRM's thirty rules
 * were like that.
 *
 * So the editor places what it is given without a place, here, from the graph's
 * own edges: a node's column is the longest path to it from a node nothing
 * points at, and nodes in one column stack in the order the graph lists them.
 * A node that already has a position keeps it, so a graph an author arranged
 * opens as they left it. Stored rules are not rewritten until somebody saves.
 */

interface PlacedNode {
  id: string;
  position?: { x?: unknown; y?: unknown } | null;
}

interface Graph<N extends PlacedNode> {
  nodes: N[];
  edges?: { sourceId?: string; targetId?: string }[];
}

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 140;
const ORIGIN = { x: 80, y: 80 };

function hasPosition(node: PlacedNode): boolean {
  const position = node.position;
  return (
    !!position &&
    typeof position.x === "number" &&
    Number.isFinite(position.x) &&
    typeof position.y === "number" &&
    Number.isFinite(position.y)
  );
}

/** The graph with every node placed. Returns the same object when none was missing. */
export function withNodePositions<N extends PlacedNode, G extends Graph<N>>(graph: G): G {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.every(hasPosition)) return graph;

  const ids = new Set(graph.nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges ?? []) {
    if (!edge.sourceId || !edge.targetId) continue;
    if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) continue;
    incoming.get(edge.targetId)?.push(edge.sourceId);
  }

  // Longest path from a source, guarded against a cycle (which a graph should
  // not have, but a hand-written one could): a node met again on the current
  // path counts as a source.
  const column = new Map<string, number>();
  const onPath = new Set<string>();
  const depth = (id: string): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (onPath.has(id)) return 0;
    onPath.add(id);
    const parents = incoming.get(id) ?? [];
    const value = parents.length === 0 ? 0 : Math.max(...parents.map(depth)) + 1;
    onPath.delete(id);
    column.set(id, value);
    return value;
  };

  const rowsUsed = new Map<number, number>();
  const nodes = graph.nodes.map((node) => {
    if (hasPosition(node)) return node;
    const col = depth(node.id);
    const row = rowsUsed.get(col) ?? 0;
    rowsUsed.set(col, row + 1);
    return {
      ...node,
      position: { x: ORIGIN.x + col * COLUMN_WIDTH, y: ORIGIN.y + row * ROW_HEIGHT },
    };
  });
  return { ...graph, nodes };
}
