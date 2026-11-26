export type AttributeValue =
  | null
  | string
  | number
  | boolean
  | AttributeValue[]
  | { [key: string]: AttributeValue };

export type Attributes = Record<string, AttributeValue>;

export interface ArchitectureNode<T extends Attributes = Attributes> {
  id: string;
  type: string;
  parent?: string;
  attributes?: T;
}

export interface ArchitectureLink<T extends Attributes = Attributes> {
  id?: string;
  source: string;
  target: string;
  type: string;
  attributes?: T;
}

export interface Architecture<
  N extends ArchitectureNode = ArchitectureNode,
  L extends ArchitectureLink = ArchitectureLink,
> {
  nodes: N[];
  links: L[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Stable 32-bit FNV-1a. Sufficient for deterministic local relationship IDs. */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function ensureLinkId<T extends ArchitectureLink>(link: T): T & { id: string } {
  if (link.id) return link as T & { id: string };
  const basis = [link.source, link.target, link.type, stableStringify(link.attributes ?? {})].join(
    "|"
  );
  return { ...link, id: `link_${stableHash(basis)}` };
}

export function canonicalizeArchitecture<A extends Architecture>(architecture: A): A {
  const nodes = [...architecture.nodes]
    .map((node) => ({
      ...node,
      attributes: node.attributes ? structuredClone(node.attributes) : undefined,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const links = [...architecture.links]
    .map((link) =>
      ensureLinkId({
        ...link,
        attributes: link.attributes ? structuredClone(link.attributes) : undefined,
      })
    )
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.type.localeCompare(b.type) ||
        a.id.localeCompare(b.id)
    );

  return { ...architecture, nodes, links } as A;
}
