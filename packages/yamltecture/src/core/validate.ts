import type { Architecture, AttributeValue, ValidationIssue, ValidationResult } from "./model";

function validateAttribute(value: AttributeValue, path: string, issues: ValidationIssue[]): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateAttribute(item, `${path}[${index}]`, issues);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (!key.trim())
        issues.push({ code: "ATTR_KEY_EMPTY", message: "Attribute key cannot be empty", path });
      validateAttribute(child, `${path}.${key}`, issues);
    }
    return;
  }
  issues.push({
    code: "ATTR_TYPE",
    message: `Unsupported attribute value type: ${typeof value}`,
    path,
  });
}

export function validateArchitecture(config: Architecture): ValidationResult {
  const issues: ValidationIssue[] = [];
  const nodes = new Map<string, (typeof config.nodes)[number]>();

  config.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!node.id?.trim())
      issues.push({
        code: "NODE_ID_EMPTY",
        message: "Node id cannot be empty",
        path: `${path}.id`,
      });
    if (!node.type?.trim())
      issues.push({
        code: "NODE_TYPE_EMPTY",
        message: "Node type cannot be empty",
        path: `${path}.type`,
      });
    if (nodes.has(node.id))
      issues.push({
        code: "NODE_DUPLICATE",
        message: `Duplicate node id '${node.id}'`,
        path: `${path}.id`,
      });
    nodes.set(node.id, node);
    if (node.attributes) validateAttribute(node.attributes, `${path}.attributes`, issues);
  });

  config.nodes.forEach((node, index) => {
    if (node.parent && !nodes.has(node.parent)) {
      issues.push({
        code: "PARENT_MISSING",
        message: `Node '${node.id}' has non-existent parent '${node.parent}'`,
        path: `nodes[${index}].parent`,
      });
    }
  });

  // Parent graph must be acyclic, matching YAMLtecture's hierarchy semantics.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const parent = nodes.get(id)?.parent;
    if (parent && visit(parent)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of nodes.keys()) {
    if (visit(id)) {
      issues.push({
        code: "PARENT_CYCLE",
        message: `Cycle detected in parent hierarchy involving '${id}'`,
      });
      break;
    }
  }

  config.links.forEach((link, index) => {
    const path = `links[${index}]`;
    if (!link.source?.trim())
      issues.push({
        code: "LINK_SOURCE_EMPTY",
        message: "Link source cannot be empty",
        path: `${path}.source`,
      });
    if (!link.target?.trim())
      issues.push({
        code: "LINK_TARGET_EMPTY",
        message: "Link target cannot be empty",
        path: `${path}.target`,
      });
    if (!link.type?.trim())
      issues.push({
        code: "LINK_TYPE_EMPTY",
        message: "Link type cannot be empty",
        path: `${path}.type`,
      });
    if (link.source && !nodes.has(link.source))
      issues.push({
        code: "LINK_SOURCE_MISSING",
        message: `Link has non-existent source '${link.source}'`,
        path: `${path}.source`,
      });
    if (link.target && !nodes.has(link.target))
      issues.push({
        code: "LINK_TARGET_MISSING",
        message: `Link has non-existent target '${link.target}'`,
        path: `${path}.target`,
      });
    if (link.attributes) validateAttribute(link.attributes, `${path}.attributes`, issues);
  });

  return { ok: issues.length === 0, issues };
}

export function assertValidArchitecture(config: Architecture): void {
  const result = validateArchitecture(config);
  if (!result.ok) {
    throw new Error(
      result.issues
        .map((issue) => `${issue.code}${issue.path ? ` ${issue.path}` : ""}: ${issue.message}`)
        .join("\n")
    );
  }
}
