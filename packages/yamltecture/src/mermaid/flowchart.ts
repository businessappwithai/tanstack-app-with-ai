import type { Architecture, ArchitectureNode } from "../core/model";
import { canonicalizeArchitecture, stableHash } from "../core/model";
import { assertValidArchitecture } from "../core/validate";
import { executeQuery } from "../query/execute";
import type { ArchitectureQuery, Filter } from "../query/model";

export type Direction = "TB" | "TD" | "BT" | "RL" | "LR";

export interface NodeStyleFormat {
  fill?: string;
  color?: string;
  "stroke-width"?: string;
  "font-size"?: string;
  padding?: string;
  rx?: string;
  ry?: string;
}

export interface LinkStyleFormat {
  stroke?: string;
  "stroke-width"?: string;
}

export interface NodeStyle {
  filters: Filter[];
  format: NodeStyleFormat;
}

export interface LinkStyle {
  filters: Filter[];
  format: LinkStyleFormat;
}

export interface MermaidSettings {
  direction?: Direction;
  nodeLabel?: string;
  subgraphNodes?: { filters: Filter[] };
  nodeStyles?: NodeStyle[];
  linkStyles?: LinkStyle[];
}

export function sanitizeLabel(label: string): string {
  return label.replace(/[[\](){}<>"]/g, "").replace(/[\r\n|;]/g, " ");
}

function attr(node: ArchitectureNode, key?: string): string | undefined {
  if (!key) return undefined;
  const value = node.attributes?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function printProps(format: NodeStyleFormat | LinkStyleFormat): string {
  return Object.entries(format)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}:${String(value).replace(/[;\r\n]/g, "")}`)
    .join(",");
}

export function generateFlowchart(config: Architecture, settings: MermaidSettings = {}): string {
  assertValidArchitecture(config);
  config = canonicalizeArchitecture(config);
  const direction = settings.direction ?? "TD";
  if (!["TB", "TD", "BT", "RL", "LR"].includes(direction))
    throw new Error("Invalid diagram direction");
  const identifier = (id: string) =>
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id) && !["end", "subgraph"].includes(id)
      ? id
      : `node_${stableHash(id)}`;
  const lines: string[] = [`flowchart ${direction}`];
  const lookup = new Map(config.nodes.map((node) => [node.id, node]));
  const parentMap = new Map(config.nodes.map((node) => [node.id, node.parent ?? ""]));

  const styleMap = new Map<string, string[]>();
  if (settings.nodeStyles?.length) {
    lines.push("    %% Node Styles");
    settings.nodeStyles.forEach((style, index) => {
      const name = `style${index}`;
      const selected = executeQuery(config, {
        nodes: { filters: style.filters },
        links: { filters: [] },
      });
      styleMap.set(name, selected.nodes.map((node) => node.id).sort());
      lines.push(`    classDef ${name} ${printProps(style.format)};`);
      lines.push("");
    });
  }

  lines.push("    %% Nodes");
  const explicit = new Set<string>();
  if (settings.subgraphNodes?.filters?.length) {
    const selected = executeQuery(config, {
      nodes: { filters: settings.subgraphNodes.filters },
      links: { filters: [] },
    });
    selected.nodes.forEach((node) => {
      explicit.add(node.id);
    });
  }

  const nearestExplicitAncestor = (start?: string): string | undefined => {
    let current = start;
    while (current) {
      if (explicit.has(current)) return current;
      current = parentMap.get(current) || undefined;
    }
    return undefined;
  };

  type Container = { id: string; children: Container[]; nodes: string[] };
  const containers = new Map<string, Container>();
  [...explicit].sort().forEach((id) => {
    containers.set(id, { id, children: [], nodes: [] });
  });
  const topContainers: Container[] = [];
  const topNodes: string[] = [];

  for (const node of config.nodes) {
    if (explicit.has(node.id)) continue;
    const ancestor = nearestExplicitAncestor(node.parent);
    if (ancestor) containers.get(ancestor)!.nodes.push(node.id);
    else topNodes.push(node.id);
  }

  for (const id of [...explicit].sort()) {
    const node = lookup.get(id)!;
    const ancestor = nearestExplicitAncestor(node.parent);
    if (ancestor) containers.get(ancestor)!.children.push(containers.get(id)!);
    else topContainers.push(containers.get(id)!);
  }

  const renderNode = (id: string, indent: string) => {
    const node = lookup.get(id)!;
    const label = attr(node, settings.nodeLabel);
    lines.push(
      label ? `${indent}${identifier(id)}[${sanitizeLabel(label)}]` : `${indent}${identifier(id)}`
    );
  };

  const renderContainer = (container: Container, indent: string) => {
    const node = lookup.get(container.id)!;
    const label = attr(node, settings.nodeLabel);
    lines.push(
      `${indent}subgraph ${identifier(container.id)}${label ? `[${sanitizeLabel(label)}]` : ""}`
    );
    container.nodes.sort().forEach((id) => {
      renderNode(id, indent + "    ");
    });
    container.children
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((child) => {
        renderContainer(child, indent + "    ");
      });
    lines.push(`${indent}end`);
  };

  topContainers
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((c) => {
      renderContainer(c, "    ");
    });
  topNodes.sort().forEach((id) => {
    renderNode(id, "    ");
  });

  if (styleMap.size) {
    lines.push("", "    %% Node Styles");
    [...styleMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([name, ids]) => {
        lines.push(`    class ${ids.map(identifier).join(",")} ${name}`);
      });
  }

  lines.push("", "    %% Links");
  const sortedLinks = [...config.links].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.type.localeCompare(b.type)
  );
  sortedLinks.forEach((link) => {
    lines.push(
      `    ${identifier(link.source)} -->|${sanitizeLabel(link.type)}| ${identifier(link.target)}`
    );
  });

  if (settings.linkStyles?.length) {
    lines.push("", "    %% Link Styles");
    settings.linkStyles.forEach((style) => {
      const query: ArchitectureQuery = {
        nodes: { filters: [] },
        links: { filters: style.filters },
      };
      const selected = executeQuery({ nodes: config.nodes, links: sortedLinks }, query);
      const selectedIds = new Set(selected.links.map((link) => link.id));
      const indices = sortedLinks
        .map((link, index) => (selectedIds.has(link.id) ? index : -1))
        .filter((index) => index >= 0);
      lines.push(`    linkStyle ${indices.join(",")} ${printProps(style.format)}`);
    });
  }

  return `${lines.join("\n")}\n`;
}
