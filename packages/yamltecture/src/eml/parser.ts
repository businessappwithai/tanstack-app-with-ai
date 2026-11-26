import { stableHash } from "../core/model";
import type {
  AiModelProjection,
  DiagramType,
  EmlDiagram,
  EmlDirective,
  EmlDocument,
  EmlEntity,
  EmlField,
  EmlRelationship,
  FlowEdge,
  StateTransition,
} from "./model";

const DIAGRAM_HEADER =
  /^(erDiagram|stateDiagram-v2|flowchart(?:\s+\S+)?|sequenceDiagram|classDiagram)\b/;

const DIRECTIVE_KEYS: Record<string, string[]> = {
  meta: ["name", "kind", "description", "version", "namespace", "domain"],
  category: ["name", "description", "icon", "color", "entities"],
  entity: ["help", "label", "description"],
  field: ["enum", "help", "label", "default", "format", "ref", "reference"],
  index: [],
  rbac: ["role"],
  report: [
    "title",
    "entity",
    "chart",
    "x",
    "y",
    "help",
    "role",
    "filter",
    "group",
    "aggregate",
    "sort",
    "limit",
  ],
  enum: [],
  rule: ["event", "priority", "when", "message"],
  action: ["when", "workflow", "message", "field", "value", "entity", "targetField", "source"],
  workflow: ["name", "entity", "kind", "description"],
  guard: [],
  loop: ["max"],
  endloop: [],
  trigger: [],
  hook: [],
  step: [
    "entity",
    "as",
    "fields",
    "field",
    "value",
    "source",
    "target",
    "targetField",
    "decisionTable",
    "operation",
    "operand",
  ],
};

function diagramType(header: string): DiagramType {
  if (header.startsWith("flowchart")) return "flowchart";
  if (header.startsWith("erDiagram")) return "erDiagram";
  if (header.startsWith("stateDiagram-v2")) return "stateDiagram-v2";
  if (header.startsWith("sequenceDiagram")) return "sequenceDiagram";
  if (header.startsWith("classDiagram")) return "classDiagram";
  return "unknown";
}

function splitByKnownKeys(
  body: string,
  keys: string[]
): { subject?: string; properties: Record<string, string> } {
  const properties: Record<string, string> = Object.create(null);
  if (!keys.length) return { subject: body.trim() || undefined, properties };
  const escaped = [...keys]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?:^|\\s)(${escaped.join("|")}):`, "g");
  const hits: Array<{ key: string; start: number; valueStart: number }> = [];
  for (const match of body.matchAll(re)) {
    const key = match[1]!;
    const markerStart = match.index + (match[0]!.startsWith(" ") ? 1 : 0);
    hits.push({ key, start: markerStart, valueStart: match.index + match[0].length });
  }
  if (!hits.length) return { subject: body.trim() || undefined, properties };
  const subject = body.slice(0, hits[0]!.start).trim() || undefined;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const end = i + 1 < hits.length ? hits[i + 1]!.start : body.length;
    properties[hit.key] = body.slice(hit.valueStart, end).trim();
  }
  return { subject, properties };
}

export function parseDirective(raw: string, line: number): EmlDirective {
  const match = /^\s*%%([A-Za-z0-9_-]+)?\s*(.*)$/.exec(raw);
  if (!match || !match[1]!) {
    return { line, kind: "comment", raw, body: raw.replace(/^\s*%%\s?/, ""), properties: {} };
  }
  const kind = match[1]!;
  if (!(kind in DIRECTIVE_KEYS))
    return { line, kind: "comment", raw, body: raw.replace(/^\s*%%\s?/, ""), properties: {} };
  const body = match[2]! ?? "";

  if (kind === "meta") {
    const m = /^([^:]+):\s*(.*)$/.exec(body);
    return {
      line,
      kind,
      raw,
      body,
      subject: m?.[1]?.trim(),
      properties: m ? { [m[1]!.trim()]: m[2]!.trim() } : {},
    };
  }
  if (kind === "enum") {
    const m = /^([^:]+):\s*(.*)$/.exec(body);
    return {
      line,
      kind,
      raw,
      body,
      subject: m?.[1]?.trim() ?? body.trim(),
      properties: m ? { values: m[2]!.trim() } : {},
    };
  }
  if (kind === "rbac") {
    const m = /^role:([^\s]+)\s+on\s+(.+)$/.exec(body);
    return {
      line,
      kind,
      raw,
      body,
      subject: m?.[2]?.trim(),
      properties: m ? { role: m[1]!.trim(), on: m[2]!.trim() } : {},
    };
  }
  if (kind === "trigger") {
    const m = /^(.*?)\s*->\s*(.*?)\s+on\s+(.+)$/.exec(body);
    return {
      line,
      kind,
      raw,
      body,
      subject: m?.[2]?.trim(),
      properties: m ? { trigger: m[1]!.trim(), handler: m[2]?.trim() ?? "", on: m[3]!.trim() } : {},
    };
  }
  if (kind === "hook") {
    const m = /^(\S+)(?:\s+(?!on\b)(\S+))?\s+on\s+(.+)$/.exec(body);
    return {
      line,
      kind,
      raw,
      body,
      subject: m?.[2]?.trim(),
      properties: m ? { event: m[1]!.trim(), handler: m[2]?.trim() ?? "", on: m[3]!.trim() } : {},
    };
  }
  if (kind === "index") {
    return { line, kind, raw, body, subject: body.trim(), properties: {} };
  }
  if (kind === "rule") {
    const on = /^(.*?)\s+on\s+(\S+)(.*)$/.exec(body);
    const rest = on ? on[3]!.trim() : body;
    const parsed = splitByKnownKeys(rest, DIRECTIVE_KEYS.rule ?? []);
    return {
      line,
      kind,
      raw,
      body,
      subject: on?.[1]?.trim() ?? parsed.subject,
      properties: { ...(on ? { entity: on[2]! } : {}), ...parsed.properties },
    };
  }

  const parsed = splitByKnownKeys(body, DIRECTIVE_KEYS[kind] ?? []);
  return { line, kind, raw, body, subject: parsed.subject, properties: parsed.properties };
}

function parseRelationship(raw: string, line: number): EmlRelationship | undefined {
  const match = /^\s*([A-Za-z_][\w]*)\s+([|o}{.-]+)\s+([A-Za-z_][\w]*)\s*:\s*(.*?)\s*$/.exec(raw);
  if (!match) return undefined;
  return {
    line,
    source: match[1]!,
    cardinality: match[2]!,
    target: match[3]!,
    label: match[4]!.replace(/^['"]|['"]$/g, "") || undefined,
    raw,
  };
}

function parseField(raw: string, line: number): EmlField | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("%%") || trimmed === "}") return undefined;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return undefined;
  return { line, type: parts[0]!, name: parts[1]!, modifiers: parts.slice(2), raw };
}

function parseStateTransition(raw: string, line: number): StateTransition | undefined {
  const m = /^\s*([^\s].*?)\s*-->\s*([^:\s]+|\[\*\])(?:\s*:\s*(.*))?\s*$/.exec(raw);
  if (!m) return undefined;
  return { line, from: m[1]!.trim(), to: m[2]!.trim(), label: m[3]?.trim(), raw };
}

function normalizeFlowNode(token: string): string {
  return token
    .trim()
    .replace(/\[.*$/, "")
    .replace(/\(.*$/, "")
    .replace(/\{.*$/, "")
    .replace(/^"|"$/g, "");
}

function parseFlowEdge(raw: string, line: number): FlowEdge | undefined {
  const m = /^\s*([A-Za-z_][\w]*)[^\n]*?\s+(?:-->|---|==>)(?:\|([^|]*)\|)?\s*([A-Za-z_][\w]*)/.exec(
    raw
  );
  if (!m) return undefined;
  return {
    line,
    from: normalizeFlowNode(m[1]!),
    to: normalizeFlowNode(m[3]!),
    label: m[2]?.trim(),
    raw,
  };
}

export function parseEml(source: string): EmlDocument {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const directives: EmlDirective[] = [];
  const metadata: Record<string, string[]> = Object.create(null);
  const entities: EmlEntity[] = [];
  const relationships: EmlRelationship[] = [];
  const diagrams: EmlDiagram[] = [];

  let currentDiagram: EmlDiagram | undefined;
  let inEr = false;
  let currentEntity: EmlEntity | undefined;

  const closeDiagram = (endLine: number) => {
    if (currentDiagram) currentDiagram.endLine = endLine;
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const raw = lines[index]!;
    const trimmed = raw.trim();

    if (trimmed.startsWith("%%")) {
      const directive = parseDirective(raw, lineNo);
      directives.push(directive);
      if (directive.kind === "meta" && directive.subject) {
        metadata[directive.subject] ??= [];
        metadata[directive.subject]!.push(directive.properties[directive.subject] ?? "");
      }
      continue;
    }

    if (DIAGRAM_HEADER.test(trimmed)) {
      closeDiagram(lineNo - 1);
      currentEntity = undefined;
      const type = diagramType(trimmed);
      currentDiagram = { line: lineNo, type, header: trimmed, endLine: lineNo };
      if (type === "stateDiagram-v2") currentDiagram.transitions = [];
      if (type === "flowchart") currentDiagram.edges = [];
      diagrams.push(currentDiagram);
      inEr = type === "erDiagram";
      continue;
    }

    if (inEr) {
      if (currentEntity) {
        if (trimmed === "}") {
          currentEntity = undefined;
          continue;
        }
        const field = parseField(raw, lineNo);
        if (field) currentEntity.fields.push(field);
        continue;
      }

      const entityStart = /^\s*([A-Za-z_][\w]*)\s*\{\s*$/.exec(raw);
      if (entityStart) {
        currentEntity = { line: lineNo, name: entityStart[1]!, fields: [] };
        entities.push(currentEntity);
        continue;
      }

      const relationship = parseRelationship(raw, lineNo);
      if (relationship) relationships.push(relationship);
    }

    if (currentDiagram?.type === "stateDiagram-v2") {
      const transition = parseStateTransition(raw, lineNo);
      if (transition) currentDiagram.transitions!.push(transition);
    } else if (currentDiagram?.type === "flowchart") {
      const edge = parseFlowEdge(raw, lineNo);
      if (edge) currentDiagram.edges!.push(edge);
    }
  }

  closeDiagram(lines.length);
  return { source, lines, directives, entities, relationships, diagrams, metadata };
}

export function projectEmlToAiModel(document: EmlDocument): AiModelProjection {
  const entities: AiModelProjection["entities"] = Object.create(null);
  for (const entity of [...document.entities].sort((a, b) => a.name.localeCompare(b.name))) {
    const fields: Record<string, { type: string; modifiers?: string[] }> = Object.create(null);
    for (const field of entity.fields) {
      fields[field.name] = {
        type: field.type,
        ...(field.modifiers.length ? { modifiers: field.modifiers } : {}),
      };
    }
    entities[entity.name] = { fields };
  }

  const metadata: Record<string, string | string[]> = Object.create(null);
  for (const key of Object.keys(document.metadata).sort()) {
    const values = document.metadata[key]!;
    metadata[key] = values.length === 1 ? values[0]! : values;
  }

  return {
    schemaVersion: 1,
    source: {
      format: "AppWithAI-EML",
      lineCount: document.lines.length,
      fingerprint: `fnv1a32:${stableHash(document.source)}`,
    },
    metadata,
    entities,
    relationships: [...document.relationships]
      .sort(
        (a, b) =>
          a.source.localeCompare(b.source) ||
          a.target.localeCompare(b.target) ||
          a.cardinality.localeCompare(b.cardinality)
      )
      .map((rel) => ({
        from: rel.source,
        to: rel.target,
        cardinality: rel.cardinality,
        ...(rel.label ? { label: rel.label } : {}),
      })),
    diagrams: document.diagrams.map((diagram) => ({
      type: diagram.type,
      line: diagram.line,
      endLine: diagram.endLine,
    })),
    directives: document.directives
      .filter((directive) => directive.kind !== "comment")
      .map((directive) => ({
        kind: directive.kind,
        line: directive.line,
        ...(directive.subject ? { subject: directive.subject } : {}),
        ...(Object.keys(directive.properties).length ? { properties: directive.properties } : {}),
        body: directive.body,
      })),
  };
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function stringifyNode(value: unknown, indent = 0): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        const child = stringifyNode(item, indent + 2);
        lines.push(`${pad}- ${child[0]!.trimStart()}`);
        lines.push(...child.slice(1));
      } else lines.push(`${pad}- ${yamlScalar(item)}`);
    }
    return lines;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    if (!keys.length) return [`${pad}{}`];
    const lines: string[] = [];
    for (const key of keys) {
      const childValue = obj[key];
      if (childValue !== null && typeof childValue === "object") {
        const child = stringifyNode(childValue, indent + 2);
        if (
          (Array.isArray(childValue) && childValue.length === 0) ||
          (!Array.isArray(childValue) && Object.keys(childValue as object).length === 0)
        ) {
          lines.push(`${pad}${yamlKey(key)}: ${child[0]!.trim()}`);
        } else {
          lines.push(`${pad}${yamlKey(key)}:`);
          lines.push(...child);
        }
      } else lines.push(`${pad}${yamlKey(key)}: ${yamlScalar(childValue)}`);
    }
    return lines;
  }
  return [`${pad}${yamlScalar(value)}`];
}

/** Deterministic YAML 1.2-compatible projection writer; intentionally no aliases/comments. */
export function aiModelToYaml(model: AiModelProjection): string {
  return `${stringifyNode(model).join("\n")}\n`;
}
