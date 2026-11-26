/**
 * Rule graphs, built the way the editor builds them: a Record, the nodes the
 * author drops on the canvas, and a Response — nodes in the editor's own JSON,
 * with the cells written as the editor's Business view writes them (quoted
 * strings, unary tests under an input).
 */

export type Cell = string;
export interface Node {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  content?: unknown;
}
export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  type: "edge";
  sourceHandle?: string;
}
export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

let counter = 0;
const uid = (p: string) => `${p}${++counter}`;

/** A decision table: `inputs` are fields, each row has one unary cell per input and one cell per output. */
export function table(
  name: string,
  inputs: string[],
  outputs: string[],
  rows: Array<{ when: Cell[]; then: Cell[] }>,
  hit: "first" | "collect" = "collect"
): Omit<Node, "position"> {
  const inCols = inputs.map((field) => ({ id: uid("i"), name: field, field }));
  const outCols = outputs.map((field) => ({ id: uid("o"), name: field, field }));
  return {
    id: uid("dt"),
    type: "decisionTableNode",
    name,
    content: {
      hitPolicy: hit,
      inputField: null,
      outputPath: null,
      passThrough: false,
      executionMode: "single",
      inputs: inCols,
      outputs: outCols,
      rules: rows.map((row) => ({
        _id: uid("r"),
        ...Object.fromEntries(inCols.map((c, i) => [c.id, row.when[i] ?? ""])),
        ...Object.fromEntries(outCols.map((c, i) => [c.id, row.then[i] ?? "''"])),
      })),
    },
  };
}

/** An expression node: each `key` is computed from the record and what ran before. */
export function expression(name: string, entries: Record<string, string>): Omit<Node, "position"> {
  return {
    id: uid("ex"),
    type: "expressionNode",
    name,
    content: {
      expressions: Object.entries(entries).map(([key, value]) => ({ id: uid("e"), key, value })),
      passThrough: true,
      inputField: null,
      outputPath: null,
      executionMode: "single",
    },
  };
}

/** A function node: the handler's return value is merged into what flows on. */
export function fn(name: string, body: string): Omit<Node, "position"> {
  return {
    id: uid("fn"),
    type: "functionNode",
    name,
    content: `export const handler = async (input) => {\n${body}\n};`,
  };
}

/** A switch node; each statement is a branch, and `branches` names what follows it. */
export function switchNode(
  name: string,
  statements: string[],
  hit: "first" | "collect" = "first"
): Omit<Node, "position"> & { statementIds: string[] } {
  const ids = statements.map(() => uid("st"));
  return {
    id: uid("sw"),
    type: "switchNode",
    name,
    statementIds: ids,
    content: {
      hitPolicy: hit,
      statements: statements.map((condition, i) => ({ id: ids[i], condition })),
    },
  };
}

/** Lay nodes out left to right and chain them; `extra` adds edges (a switch's branches). */
export function chain(
  nodes: Array<Omit<Node, "position">>,
  extra: Edge[] = [],
  links?: Array<[string, string]>
): Graph {
  const all: Node[] = [
    { id: "in", type: "inputNode", name: "Record", position: { x: 0, y: 0 } },
    ...nodes.map((n, i) => ({ ...n, position: { x: 260 * (i + 1), y: 0 } }) as Node),
    {
      id: "out",
      type: "outputNode",
      name: "Response",
      position: { x: 260 * (nodes.length + 1), y: 0 },
    },
  ];
  const edges: Edge[] = [];
  const order = ["in", ...nodes.map((n) => n.id), "out"];
  if (links) {
    for (const [a, b] of links)
      edges.push({ id: uid("e"), sourceId: a, targetId: b, type: "edge" });
  } else {
    for (let i = 0; i < order.length - 1; i++) {
      edges.push({ id: uid("e"), sourceId: order[i]!, targetId: order[i + 1]!, type: "edge" });
    }
  }
  return { nodes: all, edges: [...edges, ...extra] };
}

/** Graph position helper for hand-wired graphs (switch branches). */
export function wire(
  nodes: Array<Omit<Node, "position"> & { position?: { x: number; y: number } }>
): Node[] {
  return nodes.map((n, i) => ({ ...n, position: n.position ?? { x: 240 * i, y: 0 } }) as Node);
}

export const edge = (from: string, to: string, handle?: string): Edge => ({
  id: uid("e"),
  sourceId: from,
  targetId: to,
  type: "edge",
  ...(handle ? { sourceHandle: handle } : {}),
});

/** What a blocking row answers. */
export const BLOCK = `"validation-error"`;
export const say = (text: string) => JSON.stringify(text);
