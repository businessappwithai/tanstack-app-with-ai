// Unified Mermaid parsing module
// Converts Mermaid ERD (erDiagram) or flowchart (flowchart TD) to structured data
// Pure TypeScript, no AI required.

import type { Entity, Relationship } from "@appwithai/core/types";
import { parseMermaidFlowchart } from "@appwithai/editors/lib/mermaid-flowchart-parser";
import { MermaidParser } from "@appwithai/generator";
import type { JdmGraph } from "./jdm-converter";
import { convertToJdm } from "./jdm-converter";

export { toRenderableMermaid } from "./mermaid-render";

export type { Entity, JdmGraph, Relationship };

export interface ErdParseResult {
  type: "erd";
  entities: Entity[];
  relationships: Relationship[];
}

export interface RulesParseResult {
  type: "rules";
  jdm: JdmGraph;
}

export type MermaidParseResult = ErdParseResult | RulesParseResult;

const erdParser = new MermaidParser();

export function parseMermaid(code: string): MermaidParseResult {
  const trimmed = code.trim();

  if (trimmed.startsWith("erDiagram")) {
    const { entities, relationships } = erdParser.parse(trimmed);
    return { type: "erd", entities, relationships };
  }

  if (trimmed.startsWith("flowchart") || trimmed.startsWith("graph")) {
    const ast = parseMermaidFlowchart(trimmed);
    const jdm = convertToJdm(ast);
    return { type: "rules", jdm };
  }

  throw new Error("Unknown Mermaid diagram type. Expected 'erDiagram' or 'flowchart TD'.");
}
