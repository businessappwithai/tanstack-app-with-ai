/**
 * GoRules JDM emitter.
 *
 * Converts each EML business-rule flow into a GoRules JDM decision graph using
 * the SHIPPED converter:
 *   packages/web/src/lib/jdm-converter.ts  (convertToJdm)
 *
 * The EML parser has already produced a clean, correctly-shaped node/edge graph
 * for each rule (input/decision/expression/function/output), so we build the
 * shipped `FlowAST` structure directly from it and hand it to `convertToJdm` —
 * the same shape-to-JDM mapping the web app uses (stadium→input/output,
 * diamond→switch, circle→function, rect→expression). The result is wrapped in a
 * GoRules decision document and written as `<out>/rules/<rule>.jdm.json`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  FlowAST,
  FlowNode,
  NodeShape,
} from "../../../../packages/editors/src/lib/mermaid-flowchart-parser.ts";
import { convertToJdm } from "../../../../packages/web/src/lib/jdm-converter.ts";
import type { EmlModel, EmlRule, RuleNodeShape } from "../model.ts";
import { kebabCase } from "../util.ts";

export interface JdmDocument {
  contentType: "application/vnd.gorules.decision";
  version: "1";
  name: string;
  meta: { entity?: string; event?: string; priority?: number };
  nodes: Array<{ id: string; name: string; type: string; position: { x: number; y: number } }>;
  edges: Array<{ id: string; name?: string; sourceId: string; targetId: string }>;
}

// EML node shapes -> the shipped FlowAST NodeShape vocabulary.
const SHAPE_MAP: Record<RuleNodeShape, NodeShape> = {
  stadium: "stadium",
  diamond: "diamond",
  circle: "circle",
  rounded: "circle", // rounded = computation step, same JDM role as circle (functionNode)
  rect: "rect",
};

/** Build the shipped FlowAST from an EML rule's parsed nodes/edges. */
export function ruleToFlowAst(rule: EmlRule): FlowAST {
  const nodes = new Map<string, FlowNode>();
  for (const n of rule.nodes) {
    nodes.set(n.id, { id: n.id, label: n.label, shape: SHAPE_MAP[n.shape] });
  }
  const edges = rule.edges.map((e) => ({ source: e.source, target: e.target, label: e.label }));
  return { nodes, edges };
}

/** Convert one EML rule to a GoRules JDM document via the shipped converter. */
export function ruleToJdm(rule: EmlRule): JdmDocument {
  const graph = convertToJdm(ruleToFlowAst(rule));
  return {
    contentType: "application/vnd.gorules.decision",
    version: "1",
    name: rule.name,
    meta: { entity: rule.entity, event: rule.event, priority: rule.priority },
    nodes: graph.nodes.map((n, i) => ({
      ...n,
      position: { x: 80 + (i % 4) * 220, y: 80 + Math.floor(i / 4) * 140 },
    })),
    edges: graph.edges,
  };
}

/** Write a .jdm.json per rule plus an index. Returns written (relative) paths. */
export function generateJdm(model: EmlModel, outDir: string, subdir = "rules"): string[] {
  if (model.rules.length === 0) return [];
  const dir = path.join(outDir, subdir);
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  const index: Array<{ rule: string; file: string; entity?: string; event?: string }> = [];
  for (const rule of model.rules) {
    const doc = ruleToJdm(rule);
    const file = `${kebabCase(rule.name)}.jdm.json`;
    writeFileSync(path.join(dir, file), JSON.stringify(doc, null, 2));
    written.push(path.join(subdir, file));
    index.push({ rule: rule.name, file, entity: rule.entity, event: rule.event });
  }

  writeFileSync(path.join(dir, "index.json"), JSON.stringify({ decisions: index }, null, 2));
  written.push(path.join(subdir, "index.json"));
  return written;
}
