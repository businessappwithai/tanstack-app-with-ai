import type { Architecture } from "./model";
import { canonicalizeArchitecture } from "./model";
import { assertValidArchitecture } from "./validate";

export function mergeArchitectures(...configs: Architecture[]): Architecture {
  const seen = new Set<string>();
  const nodes = [] as Architecture["nodes"];
  const links = [] as Architecture["links"];

  for (const config of configs) {
    for (const node of config.nodes) {
      if (seen.has(node.id)) throw new Error(`duplicate node ID '${node.id}' found`);
      seen.add(node.id);
      nodes.push(structuredClone(node));
    }
    links.push(...config.links.map((link) => structuredClone(link)));
  }

  const merged = canonicalizeArchitecture({ nodes, links });
  assertValidArchitecture(merged);
  return merged;
}
