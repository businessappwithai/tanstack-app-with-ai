import YAML from "yaml";
import type { Architecture } from "./core/model";
import { canonicalizeArchitecture } from "./core/model";
import { assertValidArchitecture } from "./core/validate";
import { ArchitectureSchema } from "./schema/zod";

export function parseArchitectureYaml(source: string): Architecture {
  const parsed = ArchitectureSchema.parse(
    YAML.parse(source, { maxAliasCount: 50, uniqueKeys: true })
  );
  const config = canonicalizeArchitecture(parsed as Architecture);
  assertValidArchitecture(config);
  return config;
}

export function architectureToYaml(config: Architecture): string {
  const canonical = canonicalizeArchitecture(config);
  assertValidArchitecture(canonical);
  return YAML.stringify(canonical, { sortMapEntries: true, lineWidth: 0 });
}

export function parseYaml<T = unknown>(source: string): T {
  return YAML.parse(source, { maxAliasCount: 50, uniqueKeys: true }) as T;
}

export function stringifyYaml(value: unknown): string {
  return YAML.stringify(value, { sortMapEntries: true, lineWidth: 0 });
}
