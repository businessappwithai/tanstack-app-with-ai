import type { Architecture, ArchitectureLink, ArchitectureNode } from "../core/model";
import { assertValidArchitecture } from "../core/validate";
import type { ArchitectureQuery, Condition, Filter } from "./model";

export interface ConfigContext {
  nodesById: Map<string, ArchitectureNode>;
  childrenMap: Map<string, string[]>;
}

export function newConfigContext(config: Architecture): ConfigContext {
  const nodesById = new Map(config.nodes.map((node) => [node.id, node]));
  const childrenMap = new Map<string, string[]>();
  for (const node of config.nodes) {
    if (!node.parent) continue;
    const children = childrenMap.get(node.parent) ?? [];
    children.push(node.id);
    childrenMap.set(node.parent, children);
  }
  for (const children of childrenMap.values()) children.sort();
  return { nodesById, childrenMap };
}

function getPath(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getNodeField(node: ArchitectureNode, field: string): unknown {
  if (field === "id") return node.id;
  if (field === "type") return node.type;
  if (field === "parent") return node.parent;
  if (field.startsWith("attribute."))
    return getPath(node.attributes ?? {}, field.slice("attribute.".length));
  if (field.startsWith("attributes."))
    return getPath(node.attributes ?? {}, field.slice("attributes.".length));
  return undefined;
}

function getLinkField(link: ArchitectureLink, field: string): unknown {
  if (field === "id") return link.id;
  if (field === "source") return link.source;
  if (field === "target") return link.target;
  if (field === "type") return link.type;
  if (field.startsWith("attribute."))
    return getPath(link.attributes ?? {}, field.slice("attribute.".length));
  if (field.startsWith("attributes."))
    return getPath(link.attributes ?? {}, field.slice("attributes.".length));
  return undefined;
}

function equals(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "") return a === Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "") return Number(a) === b;
  return a === b;
}

function isChildOf(nodeId: string, target: string, ctx: ConfigContext): boolean {
  if (!ctx.nodesById.has(target)) throw new Error(`target node with ID ${target} not found`);
  return (ctx.childrenMap.get(target) ?? []).includes(nodeId);
}

function isParentOf(nodeId: string, target: string, ctx: ConfigContext): boolean {
  const targetNode = ctx.nodesById.get(target);
  if (!targetNode) throw new Error(`target node with ID ${target} not found`);
  return targetNode.parent === nodeId;
}

function isAncestorOf(nodeId: string, target: string, ctx: ConfigContext): boolean {
  const targetNode = ctx.nodesById.get(target);
  if (!targetNode) throw new Error(`target node with ID ${target} not found`);
  let parent = targetNode.parent;
  while (parent) {
    if (parent === nodeId) return true;
    parent = ctx.nodesById.get(parent)?.parent;
  }
  return false;
}

function isDescendantOf(nodeId: string, target: string, ctx: ConfigContext): boolean {
  if (!ctx.nodesById.has(target)) throw new Error(`target node with ID ${target} not found`);
  const stack = [...(ctx.childrenMap.get(target) ?? [])];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === nodeId) return true;
    stack.push(...(ctx.childrenMap.get(current) ?? []));
  }
  return false;
}

function nodeMatches(node: ArchitectureNode, condition: Condition, ctx: ConfigContext): boolean {
  if (condition.operator === "and")
    return condition.conditions.every((c) => nodeMatches(node, c, ctx));
  if (condition.operator === "or")
    return condition.conditions.some((c) => nodeMatches(node, c, ctx));
  if (condition.operator === "ancestorOf") return isAncestorOf(node.id, condition.value, ctx);
  if (condition.operator === "descendantOf") return isDescendantOf(node.id, condition.value, ctx);
  if (condition.operator === "parentOf") return isParentOf(node.id, condition.value, ctx);
  if (condition.operator === "childOf") return isChildOf(node.id, condition.value, ctx);

  if (!("field" in condition)) throw new Error("Unknown node query operator");
  const value = getNodeField(node, condition.field);
  if (condition.operator === "exists") return value !== undefined && value !== null;
  if (condition.operator === "equals") return equals(value, condition.value);
  return !equals(value, condition.value);
}

function linkMatches(link: ArchitectureLink, condition: Condition): boolean {
  if (condition.operator === "and") return condition.conditions.every((c) => linkMatches(link, c));
  if (condition.operator === "or") return condition.conditions.some((c) => linkMatches(link, c));
  if (["ancestorOf", "descendantOf", "parentOf", "childOf"].includes(condition.operator)) {
    throw new Error(`operator '${condition.operator}' is not allowed for links`);
  }
  if (!("field" in condition)) throw new Error("Hierarchy operators are not allowed on links");
  const value = getLinkField(link, condition.field);
  if (condition.operator === "exists") return value !== undefined && value !== null;
  if (condition.operator === "equals") return equals(value, condition.value);
  return !equals(value, condition.value);
}

function matchesAllNodeFilters(
  node: ArchitectureNode,
  filters: Filter[],
  ctx: ConfigContext
): boolean {
  return filters.every((filter) => nodeMatches(node, filter.condition, ctx));
}

function matchesAllLinkFilters(link: ArchitectureLink, filters: Filter[]): boolean {
  return filters.every((filter) => linkMatches(link, filter.condition));
}

export function executeQuery(config: Architecture, query: ArchitectureQuery): Architecture {
  assertValidArchitecture(config);
  const ctx = newConfigContext(config);
  const nodeFilters = query.nodes?.filters ?? [];
  const linkFilters = query.links?.filters ?? [];
  const nodes = config.nodes
    .filter((node) => matchesAllNodeFilters(node, nodeFilters, ctx))
    .map((node) => structuredClone(node));
  const selected = new Set(nodes.map((node) => node.id));

  // Preserve YAMLtecture behavior: if a selected node's parent was filtered out,
  // remove the parent reference in the returned view.
  for (const node of nodes) if (node.parent && !selected.has(node.parent)) delete node.parent;

  const links = config.links
    .filter((link) => selected.has(link.source) && selected.has(link.target))
    .filter((link) => matchesAllLinkFilters(link, linkFilters))
    .map((link) => structuredClone(link));

  return { nodes, links };
}
