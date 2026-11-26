/**
 * Parsing a model — the half of the pipeline that touches no filesystem.
 *
 * Split out of generate-application.ts because the browser stack's generator
 * runs inside a browser tab, where `node:fs` cannot be imported at all: a
 * namespace import of it at module scope fails the bundle whether or not the
 * functions using it are reachable. Everything here is pure, so both the CLI
 * and the hosted generator page get the same reading of a model from the same
 * code.
 *
 * generate-application.ts re-exports all of it, so nothing that imported these
 * from there had to change.
 */

import type { Entity, EntityEnum, Relationship } from "@appwithai/core/types";
import { extractRuleSections } from "../eml";
import type { StackOption } from "../generators/stack-option";
import { type CompiledHook, compileHooks } from "../hooks";
import { type EntityCategory, resolveCategories } from "../parsers/category.parser";
import { MermaidParser } from "../parsers/mermaid.parser";
import { attachFormSections } from "../parsers/section.parser";
import { type CompiledRbac, compileRbac } from "../rbac";
import {
  type CompiledDashboard,
  type CompiledReport,
  compileDashboards,
  compileReports,
} from "../reports";
import { type CompiledRule, compileRules } from "../rules";
import {
  type CompiledSaga,
  type CompiledWorkflow,
  compileSagaWorkflows,
  compileWorkflows,
} from "../workflows";
import type { PipelineLogger } from "./logger-port";

/** Everything a model contributes to generation. */
export interface ParsedModel {
  entities: Entity[];
  relationships: Relationship[];
  categories: EntityCategory[];
  /** `%%enum` declarations bound to a column by `%%field`, with their ids. */
  enums: EntityEnum[];
  /** Rules compiled from the model's `%%rule` decision flowcharts. */
  rules: CompiledRule[];
  /** Lifecycle handlers declared by the model's `%%hook` directives. */
  hooks: CompiledHook[];
  /** Status machines declared by the model's `%%workflow ... kind: state` sections. */
  workflows: CompiledWorkflow[];
  /** Multi-step processes declared by the model's `%%workflow ... kind: saga` sections. */
  sagas: CompiledSaga[];
  /** Role restrictions declared by `%%rbac`: CRUD operations and state transitions. */
  rbac: CompiledRbac;
  /** Questions declared by `%%report`, answered against the generated database. */
  reports: CompiledReport[];
  /** Dashboards declared by `%%dashboard`, each a role's own reports grouped. */
  dashboards: CompiledDashboard[];
}

export interface GenerationSettings {
  projectName: string;
  outputDir: string;
  projectVersion?: string;
  projectDescription?: string;
  stackOption?: StackOption;
  databaseType?: "postgresql" | "sqlite";
  /** Backend port. The frontend defaults to this + 1. */
  port?: number;
  frontendPort?: number;
  apiBaseUrl?: string;
  enableSwagger?: boolean;
  enableCors?: boolean;
  enableDarkMode?: boolean;
  skipFrontend?: boolean;
  skipBackend?: boolean;
  skipTests?: boolean;
  skipCliScaffold?: boolean;
  recordsPerEntity?: number;
  /**
   * Where the pipeline reports what it did. Injected rather than imported —
   * this same code runs in a browser tab, where the real logger cannot. See
   * `logger-port.ts`. Omitted means silence, never `console`.
   */
  logger?: PipelineLogger;
}

/**
 * Canonicalise the database identifier.
 *
 * The CLI accepts `--db postgres` as well as `postgresql`, and used to record
 * whichever spelling was typed in the manifest — so two projects generated from
 * the same model disagreed about their own database. Generation itself treats
 * anything that is not `sqlite` as PostgreSQL, so only the label was ever wrong,
 * but the label is what tooling reads back.
 */
export function normalizeDatabaseType(value: string | undefined): "postgresql" | "sqlite" {
  return value === "sqlite" ? "sqlite" : "postgresql";
}

/** Defaults, in one place, so both entry points start from the same baseline. */
export const GENERATION_DEFAULTS = {
  projectVersion: "1.0.0",
  projectDescription: "Generated application",
  stackOption: "tanstackjs-nestjs" as StackOption,
  databaseType: "postgresql" as const,
  port: 3000,
  enableSwagger: true,
  enableCors: true,
  enableDarkMode: false,
  recordsPerEntity: 1000,
  /**
   * Generate from the bundled templates rather than scaffolding first.
   *
   * `bun create tanstack-start` and `nest new` fetch a starter over the network
   * and then stop to ask questions the arguments already answer. Everything
   * they write is overwritten by the template overlay in the phase that
   * follows, so the scaffold buys nothing and costs a network round trip and an
   * interactive prompt — which is why generation from the web app hung on
   * "Enter your project name:" while the backend, whose scaffold happened to
   * fail fast, completed from templates in the same run.
   *
   * Pass `--cli-scaffold` to opt back in.
   */
  skipCliScaffold: true,
};

/**
 * Parse model source into entities, relationships and categories.
 *
 * Accepts several sources so the CLI's multi-file mode (`--sys-file`,
 * `--bus-file`, `--ref-file`) and the web app's single ERD document take the
 * same path. Categories are read from the raw text of all of them: the ERD
 * parser drops `%%` comment lines, which is where `%%category` lives.
 */
export function parseModel(sources: string | string[]): ParsedModel {
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  const parser = new MermaidParser();

  const entities: Entity[] = [];
  const enums: EntityEnum[] = [];
  const relationships: Relationship[] = [];

  for (const source of list) {
    const parsed = parser.parse(source);
    entities.push(...parsed.entities);
    enums.push(...parsed.enums);
    relationships.push(...parsed.relationships);
  }

  const joined = list.join("\n");
  // `%%section` lines are `%%` comments the ERD parser drops, so they are read
  // from the raw text, like categories, and carried on each entity.
  attachFormSections(joined, entities);
  const categories = resolveCategories(
    joined,
    entities.map((entity) => entity.name)
  );
  const warn = (message: string) => console.warn(`  \u26a0\ufe0f  ${message}`);

  // `%%rule` sections are decision flowcharts; compiling them here is what
  // carries a rule authored in the model through to the generated application.
  const rules = compileRules(extractRuleSections(joined), warn);
  // `%%hook` directives do the same for workflows: they name the handlers the
  // generated service runs around each CRUD operation.
  const hooks = compileHooks(
    joined,
    entities.map((entity) => entity.name),
    warn
  );

  // `%%workflow ... kind: state` sections become seeded workflow definitions,
  // which is what the trigger rules the generator seeds go looking for.
  const workflows = compileWorkflows(
    joined,
    entities.map((entity) => entity.name),
    warn
  );

  // `%%workflow ... kind: saga` sections are the multi-step form: each `%%step`
  // directive becomes one BPMN service task, ordered by the flowchart's edges.
  const sagas = compileSagaWorkflows(
    joined,
    entities.map((entity) => entity.name),
    warn
  );

  // `%%rbac` directives restrict CRUD operations and state transitions to named
  // roles. A target with no directive stays open, so a model that says nothing
  // about permissions generates exactly what it did before. The state machines
  // are passed in because a directive may name a transition rather than an
  // operation, and only they can resolve it.
  const rbac = compileRbac(
    joined,
    entities.map((entity) => entity.name),
    workflows,
    warn
  );

  // `%%report` directives are the questions the model says are worth asking of
  // the finished application. Compiled here rather than left to the reporting
  // platform beside it: that platform is a separate product reached through its
  // own compose file, and neither the browser application nor the zip a reader
  // downloads can reach it. The entity names resolve each report's `entity:`.
  const reports = compileReports(
    joined,
    entities.map((entity) => entity.name),
    warn
  );

  // `%%dashboard` groups a role's reports; it can only name what was compiled above.
  const dashboards = compileDashboards(
    joined,
    reports.map((report) => report.name),
    warn
  );

  return {
    entities,
    relationships,
    categories,
    enums,
    rules,
    hooks,
    workflows,
    sagas,
    rbac,
    reports,
    dashboards,
  };
}
