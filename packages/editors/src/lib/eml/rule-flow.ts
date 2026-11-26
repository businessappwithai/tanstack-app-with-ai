/**
 * Decision flows, both directions.
 *
 * A `%%rule` section in EML is a Mermaid flowchart whose node *shapes* carry
 * the decision role. The parser already turns that text into an AST; a visual
 * editor also needs the inverse, so what a designer draws on a canvas can go
 * back into the model as the same text a hand-written rule would use.
 *
 * The editable model here is deliberately narrower than GoRules JDM: it holds
 * exactly what an EML flowchart can express — a role, a label, and labelled
 * edges. Editing a richer structure and serialising it down would silently drop
 * whatever did not fit, and the first sign of that would be a rule behaving
 * differently in the generated app than it looked on screen.
 */

import { type FlowAST, type NodeShape, parseMermaidFlowchart } from "../mermaid-flowchart-parser";

/** What a node does, in the vocabulary a rule author thinks in. */
export type RuleNodeRole = "start" | "end" | "decision" | "action" | "compute";

export interface RuleFlowNode {
  id: string;
  role: RuleNodeRole;
  label: string;
  /** Canvas position. Absent for a rule authored as text. */
  position?: { x: number; y: number };
}

export interface RuleFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Branch condition on edges leaving a decision; a transition name elsewhere. */
  label?: string;
}

export interface RuleFlow {
  nodes: RuleFlowNode[];
  edges: RuleFlowEdge[];
  /**
   * `%%` directive lines inside the section that the canvas does not model,
   * kept verbatim so they survive being edited.
   *
   * The canvas understands nodes and edges. A rule section can carry more than
   * that — `%%action` is the one that matters most, because it is how a rule
   * triggers a workflow. Re-emitting only what the canvas knows deleted those
   * lines on save: opening the Logic step and pressing Save was enough to drop
   * `%%action escalateCritical trigger-workflow …` from the model, after which
   * a critical deviation no longer opened a CAPA and nothing reported an error.
   *
   * The `.mmd` is the source of truth, so the editor must not quietly narrow it
   * to the subset it can draw.
   */
  directives?: string[];
}

/**
 * Directive lines a rule section carries alongside its flowchart.
 *
 * Anything starting `%%` that is not a plain `%%` comment. Mermaid ignores them
 * and the flowchart parser drops them, so they have to be collected separately.
 */
function extractDirectives(mermaid: string): string[] {
  return (mermaid ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^%%[a-z]/i.test(line));
}

/** How each role renders as a Mermaid shape. Mirrors spec/02-business-rules.md. */
export const ROLE_SHAPES: Record<RuleNodeRole, { open: string; close: string; jdm: string }> = {
  start: { open: "([", close: "])", jdm: "inputNode" },
  end: { open: "([", close: "])", jdm: "outputNode" },
  decision: { open: "{", close: "}", jdm: "switchNode" },
  action: { open: "[", close: "]", jdm: "expressionNode" },
  compute: { open: "(", close: ")", jdm: "functionNode" },
};

export const ROLE_LABELS: Record<RuleNodeRole, string> = {
  start: "Start",
  end: "End",
  decision: "Decision",
  action: "Action",
  compute: "Compute",
};

export const ROLE_HINTS: Record<RuleNodeRole, string> = {
  start: "Where the rule begins — the input context.",
  decision: "A branch. Label each outgoing arrow with its condition.",
  action: "Set a value or apply an outcome.",
  compute: "Work out a value from the inputs.",
  end: "The rule's result.",
};

/**
 * Characters that would terminate a Mermaid shape early.
 *
 * A label is free text from a form field, so it has to be made safe before it
 * is written between `{` and `}`. Replacing rather than escaping keeps the
 * emitted document readable, and the substitutions read naturally in a label.
 */
function safeLabel(label: string): string {
  return (
    label
      .replace(
        /[[\]{}()|]/g,
        (char) =>
          ({ "[": "(", "]": ")", "{": "(", "}": ")", "(": "", ")": "", "|": "/" })[char] ?? ""
      )
      .replace(/["`]/g, "'")
      .replace(/\s+/g, " ")
      .trim() || "Step"
  );
}

/** Node ids must be Mermaid identifiers; canvas ids are free-form. */
function safeId(id: string, index: number): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `n${index}_${cleaned}`;
}

/**
 * Which role a parsed node plays.
 *
 * A stadium node is Start or End depending on direction: one with no outgoing
 * edges is the flow's result. That single-shape convention is what the EML spec
 * describes, so the reverse mapping has to look at the edges, not the shape.
 */
function roleFromShape(shape: NodeShape, hasOutgoing: boolean): RuleNodeRole {
  switch (shape) {
    case "stadium":
      return hasOutgoing ? "start" : "end";
    case "diamond":
      return "decision";
    case "circle":
    case "round":
      return "compute";
    default:
      return "action";
  }
}

/** Lay nodes out top-down in dependency order, so an imported rule reads well. */
function autoLayout(nodes: RuleFlowNode[], edges: RuleFlowEdge[]): void {
  const depth = new Map<string, number>();
  const incoming = new Map<string, number>();

  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);

  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) depth.set(id, 0);

  // Breadth-first over the DAG. Cycles keep whatever depth they were first
  // given rather than looping forever.
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    const currentDepth = depth.get(id) ?? 0;
    for (const edge of edges.filter((e) => e.source === id)) {
      if (depth.has(edge.target)) continue;
      depth.set(edge.target, currentDepth + 1);
      queue.push(edge.target);
    }
  }

  const perRow = new Map<number, number>();
  for (const node of nodes) {
    const row = depth.get(node.id) ?? 0;
    const column = perRow.get(row) ?? 0;
    perRow.set(row, column + 1);
    node.position = { x: 80 + column * 260, y: 60 + row * 130 };
  }
}

/** Read a rule's flowchart into the editable model. */
export function parseRuleFlow(mermaid: string): RuleFlow {
  const ast: FlowAST = parseMermaidFlowchart(mermaid ?? "");

  const withOutgoing = new Set(ast.edges.map((edge) => edge.source));
  const nodes: RuleFlowNode[] = [...ast.nodes.values()].map((node) => ({
    id: node.id,
    label: node.label,
    role: roleFromShape(node.shape, withOutgoing.has(node.id)),
  }));

  const edges: RuleFlowEdge[] = ast.edges.map((edge, index) => ({
    id: `e${index}_${edge.source}_${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));

  autoLayout(nodes, edges);
  return { nodes, edges, directives: extractDirectives(mermaid) };
}

/**
 * Write the editable model back out as a Mermaid flowchart.
 *
 * Node definitions come first, then edges, so every node survives even when it
 * is not yet connected — a half-drawn rule still round-trips instead of losing
 * the node the author just added.
 */
export function emitRuleFlow(flow: RuleFlow): string {
  const idMap = new Map<string, string>();
  flow.nodes.forEach((node, index) => {
    idMap.set(node.id, safeId(node.id, index));
  });

  const lines = ["flowchart TD"];

  for (const node of flow.nodes) {
    const { open, close } = ROLE_SHAPES[node.role];
    lines.push(`    ${idMap.get(node.id)}${open}${safeLabel(node.label)}${close}`);
  }

  for (const edge of flow.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) continue;
    const label = edge.label?.trim();
    lines.push(`    ${source} -->${label ? `|${safeLabel(label)}|` : ""} ${target}`);
  }

  // Directives last, after a blank line: they describe the section rather than
  // the diagram, and Mermaid renders the flowchart the same either way.
  if (flow.directives?.length) {
    lines.push("", ...flow.directives.map((directive) => `    ${directive}`));
  }

  return lines.join("\n");
}

/** Problems worth showing before a rule is saved. */
export function validateRuleFlow(flow: RuleFlow): string[] {
  const problems: string[] = [];
  if (!flow.nodes.length) return ["The rule has no steps yet."];

  const starts = flow.nodes.filter((node) => node.role === "start");
  const ends = flow.nodes.filter((node) => node.role === "end");
  if (!starts.length) problems.push("No Start step — add one so the rule has an input.");
  if (!ends.length) problems.push("No End step — add one so the rule produces a result.");

  const connected = new Set<string>();
  for (const edge of flow.edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  for (const node of flow.nodes) {
    if (!connected.has(node.id) && flow.nodes.length > 1) {
      problems.push(`"${node.label}" is not connected to anything.`);
    }
  }

  for (const decision of flow.nodes.filter((node) => node.role === "decision")) {
    const outgoing = flow.edges.filter((edge) => edge.source === decision.id);
    if (outgoing.length < 2) {
      problems.push(`Decision "${decision.label}" needs at least two branches.`);
    }
    if (outgoing.some((edge) => !edge.label?.trim())) {
      problems.push(`Every branch out of "${decision.label}" needs a condition label.`);
    }
  }

  return problems;
}
