import { type Architecture, canonicalizeArchitecture } from "../core/model";
import { executeQuery } from "../query/execute";
import type { AiModelProjection, EmlDocument } from "./model";
import { aiModelToYaml, parseEml, projectEmlToAiModel } from "./parser";

/** An informational graph; it never compiles or changes the source language. */
export function emlToArchitecture(document: EmlDocument): Architecture {
  const names = new Set(document.entities.map((entity) => entity.name));
  return canonicalizeArchitecture({
    nodes: document.entities.map((entity) => ({
      id: entity.name,
      type: "Entity",
      attributes: {
        name: entity.name,
        fields: Object.fromEntries(
          entity.fields.map((field) => [
            field.name,
            { type: field.type, modifiers: field.modifiers },
          ])
        ),
      },
    })),
    links: document.relationships
      .filter((rel) => names.has(rel.source) && names.has(rel.target))
      .map((rel) => ({
        source: rel.source,
        target: rel.target,
        type: rel.cardinality,
        attributes: { label: rel.label ?? "" },
      })),
  });
}

export function projectSource(source: string): string {
  return aiModelToYaml(projectEmlToAiModel(parseEml(source)));
}

/** Select named entities and their immediate neighbours under a bounded prompt budget. */
export function selectModelContext(
  source: string,
  question = "",
  options: { maxCharacters?: number; maxEntities?: number } = {}
) {
  const document = parseEml(source);
  const projection = projectEmlToAiModel(document);
  const graph = emlToArchitecture(document);
  const maxEntities = Math.max(1, Math.min(options.maxEntities ?? 20, 100));
  const maxCharacters = Math.max(1000, Math.min(options.maxCharacters ?? 24000, 100000));
  const words = new Set(question.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const names = graph.nodes.map((node) => node.id);
  const direct = names.filter(
    (name) => words.has(name.toLowerCase()) || words.has(`${name.toLowerCase()}s`)
  );
  const selected = new Set(direct.length ? direct : names.slice(0, maxEntities));
  if (direct.length)
    for (const link of graph.links)
      if (direct.includes(link.source) || direct.includes(link.target)) {
        selected.add(link.source);
        selected.add(link.target);
      }
  const ordered = [...selected].slice(0, maxEntities);
  const view = executeQuery(graph, {
    nodes: {
      filters: [
        {
          condition: {
            operator: "or",
            conditions: ordered.map((value) => ({ field: "id", operator: "equals", value })),
          },
        },
      ],
    },
  });
  const filtered: AiModelProjection = {
    ...projection,
    entities: Object.fromEntries(ordered.map((name) => [name, projection.entities[name]!])),
    relationships: projection.relationships.filter(
      (rel) => ordered.includes(rel.from) && ordered.includes(rel.to)
    ),
    directives: projection.directives
      .filter(
        (directive) =>
          ["meta", "enum", "category"].includes(directive.kind) ||
          ordered.some((name) => directive.body.includes(name))
      )
      .slice(0, 80),
  };
  let yaml = aiModelToYaml(filtered);
  let truncated = ordered.length < names.length;
  // Remove whole records, never cut in the middle of YAML syntax.
  while (yaml.length > maxCharacters && filtered.directives.length) {
    filtered.directives.pop();
    truncated = true;
    yaml = aiModelToYaml(filtered);
  }
  while (yaml.length > maxCharacters && Object.keys(filtered.entities).length) {
    const last = Object.keys(filtered.entities).at(-1)!;
    delete filtered.entities[last];
    filtered.relationships = filtered.relationships.filter(
      (rel) => rel.from !== last && rel.to !== last
    );
    truncated = true;
    yaml = aiModelToYaml(filtered);
  }
  if (yaml.length > maxCharacters) {
    filtered.metadata = {};
    filtered.diagrams = [];
    truncated = true;
    yaml = aiModelToYaml(filtered);
  }
  return {
    yaml,
    graph: view,
    entityNames: Object.keys(filtered.entities),
    truncated,
    fingerprint: projection.source.fingerprint,
  };
}
