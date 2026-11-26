export type DiagramType =
  | "erDiagram"
  | "stateDiagram-v2"
  | "flowchart"
  | "sequenceDiagram"
  | "classDiagram"
  | "unknown";

export interface EmlDirective {
  line: number;
  kind: string;
  raw: string;
  body: string;
  subject?: string;
  properties: Record<string, string>;
}

export interface EmlField {
  line: number;
  type: string;
  name: string;
  modifiers: string[];
  raw: string;
}

export interface EmlEntity {
  line: number;
  name: string;
  fields: EmlField[];
}

export interface EmlRelationship {
  line: number;
  source: string;
  cardinality: string;
  target: string;
  label?: string;
  raw: string;
}

export interface StateTransition {
  line: number;
  from: string;
  to: string;
  label?: string;
  raw: string;
}

export interface FlowEdge {
  line: number;
  from: string;
  to: string;
  label?: string;
  raw: string;
}

export interface EmlDiagram {
  line: number;
  type: DiagramType;
  header: string;
  endLine: number;
  transitions?: StateTransition[];
  edges?: FlowEdge[];
}

export interface EmlDocument {
  source: string;
  lines: string[];
  directives: EmlDirective[];
  entities: EmlEntity[];
  relationships: EmlRelationship[];
  diagrams: EmlDiagram[];
  metadata: Record<string, string[]>;
}

export interface AiModelProjection {
  schemaVersion: 1;
  source: {
    format: "AppWithAI-EML";
    lineCount: number;
    fingerprint: string;
  };
  metadata: Record<string, string | string[]>;
  entities: Record<
    string,
    {
      fields: Record<string, { type: string; modifiers?: string[] }>;
    }
  >;
  relationships: Array<{
    from: string;
    to: string;
    cardinality: string;
    label?: string;
  }>;
  diagrams: Array<{
    type: DiagramType;
    line: number;
    endLine: number;
  }>;
  directives: Array<{
    kind: string;
    line: number;
    subject?: string;
    properties?: Record<string, string>;
    body: string;
  }>;
}
