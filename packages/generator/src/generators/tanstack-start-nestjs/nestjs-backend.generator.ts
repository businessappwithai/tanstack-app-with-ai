/* eslint-disable @typescript-eslint/no-explicit-any -- template context objects are dynamically shaped */
/**
 * Option 1: NestJS + Fastify + Kysely Backend Generator
 *
 * Two-phase generation process:
 * 1. Scaffold using NestJS CLI (nest new)
 * 2. Overlay custom generator templates on top
 *
 * Generates a complete NestJS backend with:
 * - Fastify adapter for high performance
 * - Kysely for type-safe database operations
 * - sys_ prefixed Application Dictionary tables
 * - bus_ prefixed business entity tables
 * - Full CRUD operations with ETag concurrency
 *
 * Generated from templates in tanstack-start-nestjs/backend/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  declaredEntityNames,
  type Entity,
  type EntityEnum,
  entityToBusEntity,
  generateEntityDictionary,
  type Relationship,
} from "@appwithai/core/types";
import { type CompiledHook, HOOK_CONTRACTS, hooksByEntity } from "../../hooks";
import { generatedErrorCatalogue, generatedLogSpec } from "../../logging/generated-spec";
import type { EntityCategory } from "../../parsers/category.parser";
import { type CompiledRbac, hasRbacRules, rbacRoleNames } from "../../rbac";
import { deriveAccess } from "../../rbac/roles";
import type { CompiledReport } from "../../reports";
import type { CompiledRule } from "../../rules";
import { CliExecutor } from "../../utils/cli-executor";
import {
  buildPassThroughBpmn,
  buildSagaBpmn,
  buildStateEntryBpmn,
  type CompiledSaga,
  type CompiledWorkflow,
  describeSaga,
  describeWorkflow,
} from "../../workflows";
import { BaseGenerator } from "../base.generator";
import { DEFAULT_FRONTEND_PORT } from "../ports";
import { buildFkConstraints } from "./fk-constraints";
import { formLayoutFor } from "../../parsers/section.parser";
import {
  DOC_STATUS_COLUMN,
  STATE_FIELD_REFUSAL_CODE,
  stateFieldOf,
} from "../../../../../language/state-field";
import { renderLifecycleModule } from "./lifecycle-module";

/**
 * Carry an entity's `%%section` layout into the template context.
 *
 * `formGroups` is the sections, in order, for the seed to insert as
 * sys_field_group rows on the entity's tab; each attribute's `layout` is where
 * its field sits — group, order, column, row, span. An entity with no sections
 * gets neither, and the seed writes the flat list it always has. The browser
 * stack takes the same layout from `formLayoutFor` through the dictionary
 * generator, so one model lays out the same way in both.
 */
export function withFormLayout<
  T extends { attributes: Array<{ name: string }>; formSections?: unknown[] },
>(entity: T): T {
  const layout = formLayoutFor(entity as unknown as Parameters<typeof formLayoutFor>[0]);
  if (!layout) return entity;
  return {
    ...entity,
    formGroups: layout.groups,
    attributes: entity.attributes.map((attribute) => ({
      ...attribute,
      layout: layout.fields.get(attribute.name),
    })),
  };
}

/** Escape a value for embedding inside a single-quoted JS string literal. */
function jsQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, " ");
}

/**
 * Resolve template directory path, handling both dev and bundled environments
 */
function resolveTemplateDir(subpath: string): string {
  const cwd = process.cwd();
  const possiblePaths = [
    // Dev mode: running from project root
    path.join(cwd, "packages/generator/templates", subpath),
    // Bundled mode: running from anywhere, find generator package
    path.join(cwd, "../../../packages/generator/templates", subpath),
    path.join(cwd, "../../packages/generator/templates", subpath),
    // Fallback: current __dirname relative
    path.join(__dirname, "../../../templates", subpath),
  ];

  for (const possiblePath of possiblePaths) {
    try {
      const stat = require("node:fs").statSync(possiblePath);
      if (stat.isDirectory()) {
        return possiblePath;
      }
    } catch {
      // Continue to next path
    }
  }

  // If no path found, return the __dirname relative path and let it fail with a clear error
  const fallbackPath = path.join(__dirname, "../../../templates", subpath);
  console.error(`Template directory not found. Tried paths:`);
  for (const candidate of possiblePaths) console.error(`  - ${candidate}`);
  console.error(`Using fallback: ${fallbackPath}`);
  return fallbackPath;
}

/**
 * Clean up JSON content by fixing trailing commas and formatting issues
 * from Handlebars template rendering
 */
/**
 * Normalize JDM decision tables for GoRules zen-engine: every rule row must
 * contain a cell for every input column ("" = wildcard). Rows with missing
 * cells silently never match, so fill any gaps with the wildcard.
 */
function normalizeJdmDecisionTables(jdm: any): any {
  if (!Array.isArray(jdm?.nodes)) return jdm;
  for (const node of jdm.nodes) {
    if (node?.type !== "decisionTableNode" || !node.content) continue;
    const inputIds: string[] = (node.content.inputs ?? []).map((input: any) => input.id);
    for (const rule of node.content.rules ?? []) {
      for (const inputId of inputIds) {
        if (rule[inputId] === undefined) {
          rule[inputId] = "";
        }
      }
    }
  }
  return jdm;
}

function cleanJsonContent(jsonStr: string): string {
  try {
    // Remove trailing commas before } and ]
    let cleaned = jsonStr.replace(/,(\s*[}\]])/g, "$1");
    // Remove leading commas after [ and {
    cleaned = cleaned.replace(/(\[\s*),/g, "$1");
    cleaned = cleaned.replace(/(\{\s*),/g, "$1");
    // Parse and reformat to ensure valid JSON
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch (_e) {
    // If parsing fails, return original but still try to fix obvious issues
    return jsonStr.replace(/,(\s*[}\]])/g, "$1").replace(/(\[\s*),/g, "$1");
  }
}

export interface NestJsBackendOptions {
  projectName: string;
  projectVersion: string;
  projectDescription: string;
  databaseType: "postgresql" | "mysql" | "sqlite";
  port: number;
  frontendPort?: number;
  enableSwagger: boolean;
  enableCors: boolean;
  /**
   * Skip the network CLI scaffolding step (`bun x nest new`) and generate the
   * project purely from the bundled templates. Useful for offline / CI
   * generation where the NestJS CLI is unavailable.
   */
  skipCliScaffold?: boolean;
  /**
   * Application Dictionary entity categories, parsed from the model's
   * `%%category` directives. When absent a single "General" default is seeded.
   */
  categories?: EntityCategory[];
  /** `%%enum` declarations bound to columns, each with its list reference id. */
  modelEnums?: EntityEnum[];
  /** Business rules compiled from the model's `%%rule` sections. */
  compiledRules?: CompiledRule[];
  /** Lifecycle handlers compiled from the model's `%%hook` directives. */
  compiledHooks?: CompiledHook[];
  /** Status machines compiled from the model's state workflows. */
  compiledWorkflows?: CompiledWorkflow[];
  /** Multi-step processes compiled from the model's `kind: saga` workflows. */
  compiledSagas?: CompiledSaga[];
  /** Role restrictions from `%%rbac` — operations and transitions. */
  compiledRbac?: CompiledRbac;
  /** Questions from `%%report`, seeded into sys_report and served by /sys/reports. */
  compiledReports?: CompiledReport[];
}

/**
 * The `src/common/**` templates every generated backend gets.
 *
 * Exported so `__tests__/common-templates.test.ts` can assert each one exists
 * without re-parsing this file. The list is not allowed to name a template
 * that is not there: see the loop that consumes it.
 */
export const COMMON_TEMPLATES = [
  "src/common/filters/http-exception.filter.ts",
  "src/common/guards/user-throttler.guard.ts",
  "src/common/interceptors/transform.interceptor.ts",
  "src/common/logging/logger.service.ts",
  "src/common/pipes/zod-validation.pipe.ts",
] as const;

export class NestJsBackendGenerator extends BaseGenerator {
  private options: NestJsBackendOptions;
  private resolvedTemplateDir: string;

  constructor(options: NestJsBackendOptions) {
    // Resolve template directory correctly regardless of bundling
    const templateDir = resolveTemplateDir("tanstack-start-nestjs/backend");
    super(templateDir);
    this.options = options;
    this.resolvedTemplateDir = templateDir;
  }

  async generate(
    entities: Entity[],
    relationships: Relationship[],
    outputDir: string
  ): Promise<void> {
    if (this.options.skipCliScaffold) {
      console.log(`\n📦 Phase 1: Skipping CLI scaffold (template-only mode)`);
      await fs.mkdir(outputDir, { recursive: true });
    } else {
      console.log(`\n📦 Phase 1: Scaffolding NestJS project...`);
      await this.scaffoldNestJsProject(outputDir);
    }

    console.log(`\n🎨 Phase 2: Overlaying custom templates...`);
    // Prepare context for templates
    const context = this.prepareContext(entities, relationships);

    // Create additional directories needed for generated code
    await this.createAdditionalDirectories(outputDir);

    // Generate core application files
    await this.generateCoreFiles(outputDir, context);

    // Generate sys_ dictionary infrastructure
    await this.generateSysTables(outputDir, context);

    // Generate Electric shape proxy module
    await this.generateElectricModule(outputDir, context);

    // Generate bus_ business entities
    await this.generateBusEntities(outputDir, context);

    // Generate audit module (static files)
    await this.generateAuditModule(outputDir);

    // Generate the notifications module (static files) — the bell's backend
    await this.generateNotificationsModule(outputDir);

    // The route the browser reports its errors to
    await this.generateClientLogsModule(outputDir);

    // Generate workflow-definitions module (static files)
    await this.generateWorkflowDefinitionsModule(outputDir);

    // Generate the model-context module — retrieval over the app's own model
    await this.generateModelContextModule(outputDir, context);

    // Generate migrations and seeds
    await this.generateMigrations(outputDir, context);

    // Update/enhance configuration files
    await this.updateConfigFiles(outputDir, context);

    // Generate test files
    await this.generateTestFiles(outputDir, context);

    console.log(`\n✅ NestJS backend generation complete!`);
  }

  /**
   * Phase 1: Scaffold base NestJS project using CLI
   */
  private async scaffoldNestJsProject(outputDir: string): Promise<void> {
    const parentDir = path.dirname(outputDir);
    const projectName = path.basename(outputDir);

    // Check if nest CLI is available
    if (!CliExecutor.isCommandAvailable("nest")) {
      console.warn(`\n⚠️  NestJS CLI not found globally. Attempting to use npx...`);
    }

    // Create parent directory if it doesn't exist
    await fs.mkdir(parentDir, { recursive: true });

    try {
      // Run nest new with --package-manager bun and --skip-git flag
      // This creates the base scaffolding structure
      console.log(`  Creating NestJS project: ${projectName}`);
      await CliExecutor.executeAsync(
        "bun",
        ["x", "nest", "new", projectName, "--package-manager", "bun", "--skip-git"],
        {
          cwd: parentDir,
          stdio: "inherit",
          timeout: 300000,
        }
      );

      console.log(`  ✅ NestJS scaffolding complete`);
    } catch (error) {
      // Not fatal, and not unusual: `nest new` needs the npm registry, and the
      // templates below write every file the generated backend needs regardless.
      console.log(
        `  Skipping CLI scaffolding (${(error as Error).message.split("\n")[0]}) — generating from templates`
      );
    }
  }

  /**
   * Create additional directories beyond what NestJS CLI scaffolds
   */
  private async createAdditionalDirectories(outputDir: string): Promise<void> {
    const dirs = [
      /* No `src/common/decorators`: it held the ETag decorator that was
         never written, and creating it left every generated application with
         an empty directory. The auth decorators live under
         `src/modules/auth/decorators`, which is created with that module. */
      "src/common/errors",
      "src/common/filters",
      "src/common/guards",
      "src/common/interceptors",
      "src/common/pipes",
      "src/config",
      "src/database",
      "src/lib",
      "src/modules/auth/decorators",
      "src/modules/auth/guards",
      "src/modules/hooks",
      "src/modules/sys",
      "src/modules/bus",
      "src/modules/jobs",
      "src/modules/rules/dto",
      "src/modules/rules/jdm",
      "src/modules/audit",
      "src/modules/notifications",
      "src/modules/client-logs",
      "src/modules/workflow",
      "src/modules/workflow-definitions",
      "src/trigger",
      "src/migrations",
      "seeds",
      "test/modules/auth",
      "test/modules/jobs",
      "test/trigger",
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(outputDir, dir), { recursive: true });
    }
  }

  private prepareContext(
    entities: Entity[],
    relationships: Relationship[]
  ): Record<string, unknown> {
    /*
     * Convert to bus_ prefixed entities, parents before their line items.
     *
     * The dictionary seed declares one `const …WindowId` per entity and a child
     * names its parent's. `const` is not usable before its declaration, so a
     * model that happened to declare `InvoiceLine` above `Invoice` rendered a
     * seed that would not compile. Ordering here costs nothing and removes the
     * dependency on how the author arranged the file.
     */
    const declared = declaredEntityNames(entities);
    const busEntities = entities
      .map((entity) => withFormLayout(entityToBusEntity(entity, declared)))
      .sort((a, b) => Number(!!a.parentEntity) - Number(!!b.parentEntity));

    // Generate dictionary entries using the proper helper function
    const dictionaryEntries = entities.map((entity) => generateEntityDictionary(entity));

    // Extract sys_table entries from dictionary
    const sysTables = dictionaryEntries.map((entry) => entry.dictionaryPlaceholders.table);

    // `%%enum` declarations bound to a column. The references seed writes one
    // sys_reference (validation type L) plus its sys_ref_list values per entry,
    // and the columns above already point at the matching id.
    const modelEnums = this.options.modelEnums ?? [];

    // Generate sys_column entries from bus attributes
    const sysColumns = dictionaryEntries.flatMap((entry, entityIndex) => {
      const busAttrs = entry.busAttributes;
      return busAttrs.map((attr, _index) => ({
        sys_table_id: `table_${entityIndex}`, // Placeholder ID
        column_name: attr.columnName,
        name: attr.displayName,
        sys_reference_id: attr.referenceId,
        is_key: attr.name === entry.busEntity.primaryKey,
        is_mandatory: attr.required,
        is_updateable: attr.name !== entry.busEntity.primaryKey,
        seq_no: attr.seqNo,
        is_active: true,
        created_by: "System",
        updated_by: "System",
      }));
    });

    // Generate sys_field entries with randomized seq_no
    const sysFields = dictionaryEntries.flatMap((entry, entityIndex) => {
      return entry.busAttributes.map((attr, index) => ({
        sys_tab_id: `tab_${entityIndex}`, // Placeholder ID
        sys_column_id: `column_${entityIndex}_${index}`, // Placeholder ID
        name: attr.displayName,
        seq_no: (index + 1) * 10,
        seq_no_grid: (index + 1) * 10,
        is_displayed: true,
        is_displayed_grid: true,
        is_active: true,
        created_by: "System",
        updated_by: "System",
      }));
    });

    // `%%rbac` restrictions. Resolved here rather than in the template so the
    // transition rules can be paired with the status column each machine drives.
    const rbac = this.options.compiledRbac ?? { operations: [], transitions: [] };

    /* Roles, their accounts and per-entity visibility. An application seeded
       with an administrator and three generic placeholders could not show what
       the model's `%%rbac` did, because the administrator bypasses all of it and
       "Manager" holds none of it. */
    const access = deriveAccess(rbac, {
      projectId: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      entities: busEntities.map((entity: { name: string }) => entity.name),
    });

    // Detect current database user (for PostgreSQL)
    const dbUser =
      this.options.databaseType === "postgresql"
        ? process.env.USER || process.env.USERNAME || "postgres"
        : "postgres";

    const fkOverrides = this.buildFkOverrides(busEntities, relationships);
    const fkConstraints = buildFkConstraints(busEntities, relationships);

    return {
      project: {
        name: this.options.projectName,
        version: this.options.projectVersion,
        description: this.options.projectDescription,
        id: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        snake: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      },
      config: {
        databaseType: this.options.databaseType,
        port: this.options.port,
        frontendPort: this.options.frontendPort ?? DEFAULT_FRONTEND_PORT,
        enableSwagger: this.options.enableSwagger,
        enableCors: this.options.enableCors,
        dbUser: dbUser,
        corsOrigin: `http://localhost:${this.options.frontendPort ?? DEFAULT_FRONTEND_PORT}`,
      },
      databaseType: this.options.databaseType,
      projectName: this.options.projectName,
      projectSnake: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      projectKebab: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      entities: busEntities,
      relationships,
      fkConstraints,
      fkOverrides,
      sysTables,
      sysColumns,
      modelEnums,
      sysFields,
      categories: this.prepareCategories(busEntities),
      compiledRules: (this.options.compiledRules ?? []).map((rule) => ({
        ...rule,
        // Embedded in a single-quoted literal in the seed, so escape it here
        // rather than trusting a template helper to do it.
        jdmContentEscaped: jsQuote(rule.jdmContent),
      })),
      // `%%rbac` restrictions. `rbacRoles` is the distinct set the seed creates
      // in sys_role first, so a rule naming a role the model never listed under
      // a user still resolves instead of pointing at nothing.
      compiledRbac: rbac.operations,
      compiledRbacTransitions: rbac.transitions.map((rule) => ({
        ...rule,
        // The status column the machine drives. Mirrors the resolution in the
        // workflow-definitions seed, which is what puts a record into a state
        // in the first place. An entity with no machine moves on doc_status.
        statusField: this.hasMachine(rule.entity)
          ? this.statusFieldFor(rule.tableName, busEntities)
          : DOC_STATUS_COLUMN,
        // A drawn edge is a move; anything else the compiler accepted is a Final
        // state back to Draft — a reopen, which only the roles named may make.
        edges: rule.edges.map((edge) => ({
          ...edge,
          kind: this.isDrawnEdge(rule.entity, edge.from, edge.to) ? "move" : "reopen",
        })),
      })),
      rbacRoles: rbacRoleNames(rbac),
      hasRbac: hasRbacRules(rbac),
      // The functional roles, one account per role, and which entities each may
      // look at — derived by the same function the browser stack writes into
      // `model.json`, so the two builds cannot disagree about who sees what.
      access,
      now: new Date().toISOString(),
    };
  }

  /**
   * The column a state machine drives for a table.
   *
   * Repeats the rule used when seeding the workflow definitions — `status` when
   * the model gave the entity one, `workflow_status` otherwise — because a
   * transition rule has to name the same column the transition writes. Reading
   * a different one would make every transition restriction inert.
   */
  /** The entity's state machine, when the model draws one. */
  private machineOf(entity: string): CompiledWorkflow | undefined {
    return (this.options.compiledWorkflows ?? []).find((workflow) => workflow.entity === entity);
  }

  private hasMachine(entity: string): boolean {
    return this.machineOf(entity) !== undefined;
  }

  private isDrawnEdge(entity: string, from: string, to: string): boolean {
    return (this.machineOf(entity)?.transitions ?? []).some(
      (edge) => edge.from === from && edge.to === to
    );
  }

  private statusFieldFor(
    tableName: string,
    busEntities: Array<{
      tableName: string;
      attributes?: Array<{ columnName?: string; name?: string }>;
    }>
  ): string {
    const entity = busEntities.find((candidate) => candidate.tableName === tableName);
    const columns = (entity?.attributes ?? []).map((a) => a.columnName ?? a.name);
    return stateFieldOf(columns.filter((name): name is string => !!name)) ?? "workflow_status";
  }

  /**
   * Shape the model's categories for the seed template: escape strings for
   * embedding in JS literals, and translate ERD entity names into the physical
   * `bus_*` table names the seed matches `sys_table` on.
   */
  private prepareCategories(busEntities: Array<{ name: string; tableName: string }>) {
    const categories =
      this.options.categories && this.options.categories.length > 0
        ? this.options.categories
        : [
            {
              name: "General",
              code: "general",
              description: "Default grouping for all business entities",
              icon: "LayoutGrid",
              color: undefined,
              seqNo: 0,
              isDefault: true,
              entities: busEntities.map((entity) => entity.name),
            },
          ];

    // ERD names are matched case-insensitively — a model may write `Compound`
    // in the ERD block and `compound` in a directive.
    const tableByName = new Map(
      busEntities.map((entity) => [entity.name.toLowerCase(), entity.tableName])
    );

    return categories.map((category) => ({
      name: jsQuote(category.name),
      code: category.code,
      description: category.description ? jsQuote(category.description) : "",
      icon: category.icon ?? "",
      color: category.color ?? "",
      seqNo: category.seqNo,
      isDefault: category.isDefault,
      tables: category.entities
        .map((entityName) => tableByName.get(entityName.toLowerCase()))
        .filter((tableName): tableName is string => !!tableName),
    }));
  }

  private buildFkOverrides(
    busEntities: Array<{
      tableName: string;
      originalName?: string;
      name: string;
      attributes?: Array<{ name: string; columnName?: string; isForeignKey?: boolean }>;
    }>,
    relationships: Relationship[]
  ): Array<{ column: string; table: string }> {
    const tableSet = new Set(busEntities.map((e) => e.tableName));
    const entityToTable = new Map(
      busEntities.map((e) => [(e.originalName || e.name).toLowerCase(), e.tableName])
    );

    const overrides: Array<{ column: string; table: string }> = [];
    const seen = new Set<string>();

    for (const entity of busEntities) {
      const entityName = (entity.originalName || entity.name).toLowerCase();
      const fkAttrs = (entity.attributes || []).filter((a) => a.isForeignKey);
      const parentRels = relationships.filter((r) => r.targetEntity.toLowerCase() === entityName);

      for (const attr of fkAttrs) {
        const col = attr.columnName || attr.name;
        if (seen.has(col)) continue;
        const base = col.replace(/_id$/, "");
        if (tableSet.has(`bus_${base}`)) continue;

        for (const rel of parentRels) {
          const srcTable = entityToTable.get(rel.sourceEntity.toLowerCase());
          if (!srcTable) continue;
          const srcBase = srcTable.replace(/^bus_/, "");
          if (base === srcBase) continue;
          const alreadyResolved = fkAttrs.some((a) => {
            const b = (a.columnName || a.name).replace(/_id$/, "");
            return b === srcBase;
          });
          if (alreadyResolved) continue;
          overrides.push({ column: col, table: srcTable });
          seen.add(col);
          break;
        }
      }
    }

    /*
     * The table a role-named column points at, or null when the model has no
     * person entity at all.
     *
     * It used to fall back to the literal string "bus_user" when none of the
     * three existed, which aliased `author_id` to a table that is not in the
     * schema: the lookup had no table to search, the reference degraded to a
     * box asking for a uuid, and every create that needed the foreign key was
     * refused. A model with an `Author` entity and no `User` one — the smallest
     * blog there is — produced an application whose Post could not be written.
     */
    const personTable = tableSet.has("bus_user")
      ? "bus_user"
      : tableSet.has("bus_staff")
        ? "bus_staff"
        : tableSet.has("bus_employee")
          ? "bus_employee"
          : null;

    const personRoleColumns = [
      "pi_id",
      "lab_manager_id",
      "assigned_to",
      "owner_id",
      "author_id",
      "manager_id",
      "user_id",
      "created_by_user",
      "remediation_owner",
      "remediation_owner_id",
    ];
    /*
     * A role-named column is a *guess* — `owner_id` usually means a person —
     * and it loses to the naming convention. `author_id` in a model that
     * declares an `Author` entity resolves to `bus_author` by the ordinary
     * rule, and overriding that with the guess sends the reference somewhere
     * the model never pointed it.
     */
    for (const col of personRoleColumns) {
      if (seen.has(col)) continue;
      if (!personTable) continue;
      if (tableSet.has(`bus_${col.replace(/_id$/, "")}`)) continue;
      overrides.push({ column: col, table: personTable });
      seen.add(col);
    }

    for (const entity of busEntities) {
      const fkAttrs = (entity.attributes || []).filter((a) => a.isForeignKey);
      for (const attr of fkAttrs) {
        const col = attr.columnName || attr.name;
        if (seen.has(col)) continue;
        if (personTable && (col.endsWith("_by_id") || col.endsWith("_by"))) {
          overrides.push({ column: col, table: personTable });
          seen.add(col);
        }
      }
    }

    return overrides;
  }

  private async generateCoreFiles(outputDir: string, context: any): Promise<void> {
    // Main entry point
    const mainContent = await this.renderTemplate("src/main.ts.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/main.ts"), mainContent);

    // App module
    const appModuleContent = await this.renderTemplate("src/app.module.ts.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/app.module.ts"), appModuleContent);

    // Standard NestJS scaffolded files (static, no templating needed)
    // `app.controller.spec.ts` used to be listed here and has never existed in
    // the templates, so every generation printed a warning about a file nobody
    // was missing. A warning that is always there is a warning nobody reads.
    const staticAppFiles = ["src/app.controller.ts", "src/app.service.ts"];
    for (const file of staticAppFiles) {
      try {
        await fs.copyFile(path.join(this.resolvedTemplateDir, file), path.join(outputDir, file));
      } catch (_e) {
        console.warn(`Static app file not found: ${file}`);
      }
    }

    /*
     * Common components. Every entry must have a template.
     *
     * The loop below used to wrap this in a try/catch commented "Template may
     * not exist, skip", and three entries had rotted behind it unnoticed:
     * `etag.decorator.ts` and `etag.guard.ts`, for an ETag feature that was
     * never written — the only trace left of it is `ETag` in the CORS
     * `exposedHeaders` — and `logging.interceptor.ts`, deliberately replaced
     * by the Fastify `onResponse` hook because an interceptor runs after the
     * guards and so sees no 401, no 403 and none of the better-auth routes.
     *
     * The swallow was worse than the stale entries it hid. A Handlebars syntax
     * error raises here too, and was indistinguishable from a missing file: the
     * template would vanish from the generated application and the first sign
     * of it would be a build failure somewhere else entirely.
     */
    for (const file of COMMON_TEMPLATES) {
      const content = await this.renderTemplate(`${file}.hbs`, context);
      await fs.mkdir(path.dirname(path.join(outputDir, file)), { recursive: true });
      await fs.writeFile(path.join(outputDir, file), content);
    }

    // The log specification the application runs on, derived from the
    // generator's canonical one rather than kept as a second copy under
    // templates/ — see packages/generator/src/logging/generated-spec.ts. It is
    // written directly rather than rendered, because it is data and Handlebars
    // has nothing to substitute into it.
    await fs.mkdir(path.join(outputDir, "src/common/logging"), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "src/common/logging/log-spec.json"),
      generatedLogSpec()
    );

    // The errors the application can raise. The catalogue is derived from the
    // same spec as log-spec.json, so a code means one thing in the log and in the
    // response; the two modules beside it are plain TypeScript and are copied.
    await fs.mkdir(path.join(outputDir, "src/common/errors"), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "src/common/errors/catalogue.ts"),
      generatedErrorCatalogue()
    );
    for (const file of ["app-error.ts", "classify.ts"]) {
      await fs.copyFile(
        path.join(this.resolvedTemplateDir, "src/common/errors", file),
        path.join(outputDir, "src/common/errors", file)
      );
    }

    // Auth module decorators and guards (in module path for BetterAuth integration)
    try {
      const publicDecoratorContent = await this.renderTemplate(
        "src/modules/auth/decorators/public.decorator.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/decorators/public.decorator.ts"),
        publicDecoratorContent
      );
    } catch (_e) {
      console.warn("Public decorator template not found");
    }

    try {
      const rolesDecoratorContent = await this.renderTemplate(
        "src/modules/auth/decorators/roles.decorator.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/decorators/roles.decorator.ts"),
        rolesDecoratorContent
      );
    } catch (_e) {
      console.warn("Roles decorator template not found");
    }

    try {
      const currentUserDecoratorContent = await this.renderTemplate(
        "src/modules/auth/decorators/current-user.decorator.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/decorators/current-user.decorator.ts"),
        currentUserDecoratorContent
      );
    } catch (_e) {
      console.warn("Current user decorator template not found");
    }

    try {
      const jwtGuardContent = await this.renderTemplate(
        "src/modules/auth/guards/jwt-auth.guard.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/guards/jwt-auth.guard.ts"),
        jwtGuardContent
      );
    } catch (_e) {
      console.warn("JWT auth guard template not found");
    }

    try {
      const sessionAuthGuardContent = await this.renderTemplate(
        "src/modules/auth/guards/session-auth.guard.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/guards/session-auth.guard.ts"),
        sessionAuthGuardContent
      );
    } catch (_e) {
      console.warn("Session auth guard template not found");
    }

    try {
      const rolesGuardContent = await this.renderTemplate(
        "src/modules/auth/guards/roles.guard.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/guards/roles.guard.ts"),
        rolesGuardContent
      );
    } catch (_e) {
      console.warn("Roles guard template not found");
    }

    // Entity access guard — enforces the model's %%rbac rules on /bus CRUD.
    // Always emitted, not gated on the model declaring any: BusController
    // references it unconditionally, so a model with no %%rbac would otherwise
    // generate a backend that does not compile.
    try {
      const entityAccessGuardContent = await this.renderTemplate(
        "src/modules/auth/guards/entity-access.guard.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/guards/entity-access.guard.ts"),
        entityAccessGuardContent
      );
    } catch (_e) {
      console.warn("Entity access guard template not found");
    }

    // Dictionary write guard — SysController references it unconditionally.
    try {
      const dictionaryWriteGuardContent = await this.renderTemplate(
        "src/modules/auth/guards/dictionary-write.guard.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/guards/dictionary-write.guard.ts"),
        dictionaryWriteGuardContent
      );
    } catch (_e) {
      console.warn("Dictionary write guard template not found");
    }

    // What a user's roles grant, one query and cached — read by every guard.
    await fs.writeFile(
      path.join(outputDir, "src/modules/auth/capability.service.ts"),
      await this.renderTemplate("src/modules/auth/capability.service.ts.hbs", context)
    );

    // Auth controller and module
    try {
      const authControllerContent = await this.renderTemplate(
        "src/modules/auth/auth.controller.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/auth.controller.ts"),
        authControllerContent
      );
    } catch (_e) {
      console.warn("Auth controller template not found");
    }

    try {
      const authModuleContent = await this.renderTemplate(
        "src/modules/auth/auth.module.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/modules/auth/auth.module.ts"),
        authModuleContent
      );
    } catch (_e) {
      console.warn("Auth module template not found");
    }

    // Better-auth lib
    try {
      const betterAuthContent = await this.renderTemplate("src/lib/better-auth.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "src/lib/better-auth.ts"), betterAuthContent);
    } catch (_e) {
      console.warn("Better-auth lib template not found");
    }

    // Hook system (standalone)
    const hookFiles = [
      { tpl: "src/modules/hooks/hook.types.ts.hbs", out: "src/modules/hooks/hook.types.ts" },
      { tpl: "src/modules/hooks/hook-registry.ts.hbs", out: "src/modules/hooks/hook-registry.ts" },
      { tpl: "src/modules/hooks/hook-executor.ts.hbs", out: "src/modules/hooks/hook-executor.ts" },
      { tpl: "src/modules/hooks/index.ts.hbs", out: "src/modules/hooks/index.ts" },
    ];

    for (const { tpl, out } of hookFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Hook template not found: ${tpl}`);
      }
    }

    // Trigger.dev configuration
    try {
      const triggerConfigContent = await this.renderTemplate("trigger.config.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "trigger.config.ts"), triggerConfigContent);
    } catch (_e) {
      console.warn("Trigger.dev config template not found");
    }

    // Trigger.dev tasks.
    //
    // `entity-promotion` is the one the application itself dispatches on every
    // write: PromotionDispatcher triggers it by that id, so a build that omits
    // it turns every save under Trigger.dev into a dispatch failure.
    const triggerTasks = [
      "email",
      "report",
      "sync",
      "entity-lifecycle-workflow",
      "entity-promotion",
    ];
    for (const task of triggerTasks) {
      try {
        const taskContent = await this.renderTemplate(`src/trigger/${task}.task.ts.hbs`, context);
        await fs.writeFile(path.join(outputDir, `src/trigger/${task}.task.ts`), taskContent);
      } catch (_e) {
        console.warn(`Trigger task template not found: ${task}`);
      }
    }

    // The Nest root the promotion task bootstraps. Not a task itself — the
    // `dirs` glob in trigger.config.ts picks up the whole directory, and a
    // module file there is imported by the task rather than scanned for one.
    try {
      const workerModule = await this.renderTemplate(
        "src/trigger/promotion-worker.module.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/trigger/promotion-worker.module.ts"),
        workerModule
      );
    } catch (_e) {
      console.warn("Promotion worker module template not found");
    }

    // Job queue module
    const jobQueueFiles = [
      {
        tpl: "src/modules/jobs/job-queue.module.ts.hbs",
        out: "src/modules/jobs/job-queue.module.ts",
      },
      {
        tpl: "src/modules/jobs/job-queue.service.ts.hbs",
        out: "src/modules/jobs/job-queue.service.ts",
      },
      {
        tpl: "src/modules/jobs/job-queue.controller.ts.hbs",
        out: "src/modules/jobs/job-queue.controller.ts",
      },
    ];

    for (const { tpl, out } of jobQueueFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Job queue template not found: ${tpl}`);
      }
    }

    // Rules module
    const rulesFiles = [
      { tpl: "src/modules/rules/dto/rules.dto.ts.hbs", out: "src/modules/rules/dto/rules.dto.ts" },
      { tpl: "src/modules/rules/rules.module.ts.hbs", out: "src/modules/rules/rules.module.ts" },
      { tpl: "src/modules/rules/rules.service.ts.hbs", out: "src/modules/rules/rules.service.ts" },
      {
        tpl: "src/modules/rules/rules.controller.ts.hbs",
        out: "src/modules/rules/rules.controller.ts",
      },
      {
        tpl: "src/modules/rules/rules-engine.service.ts.hbs",
        out: "src/modules/rules/rules-engine.service.ts",
      },
    ];

    for (const { tpl, out } of rulesFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Rules template not found: ${tpl}`);
      }
    }

    // Workflow module
    const workflowFiles = [
      {
        tpl: "src/modules/workflow/workflow.module.ts.hbs",
        out: "src/modules/workflow/workflow.module.ts",
      },
      {
        tpl: "src/modules/workflow/workflow.service.ts.hbs",
        out: "src/modules/workflow/workflow.service.ts",
      },
      {
        tpl: "src/modules/workflow/workflow.controller.ts.hbs",
        out: "src/modules/workflow/workflow.controller.ts",
      },
    ];

    for (const { tpl, out } of workflowFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Workflow template not found: ${tpl}`);
      }
    }

    // bpmn-executor.service.ts used to be copied here. It was a second, never
    // registered BPMN executor that no module imported, and it disagreed with
    // the live one in workflow.service.ts (it did not `bus_`-prefix tables, and
    // it lacked the row-targeting rules). Two implementations, one dead, is a
    // trap for whoever debugs a workflow next; the live one is the only one.

    // JDM rule files per entity — delegates to shared private helper
    for (const busEntity of context.entities) {
      await this.writeEntityJdm(busEntity, outputDir);
    }
  }

  /** Shared JDM file writer — used by both full generation and generateSingleEntity. */
  private async writeEntityJdm(busEntity: any, outputDir: string): Promise<void> {
    try {
      // A state field is never required of the writer: the system puts a new
      // record into the machine's initial state, and a person may not send one.
      // A "<Status> is required" row would refuse every create the guard had
      // just stripped the state from.
      const hasMachine = (this.options.compiledWorkflows ?? []).some(
        (workflow) => workflow.entity === busEntity.name || workflow.entity === busEntity.className
      );
      const columns: string[] = (busEntity.attributes ?? []).map((a: any) => a.columnName ?? a.name);
      const stateField = hasMachine ? stateFieldOf(columns) : undefined;
      let jdmContent = await this.renderTemplate("src/modules/rules/jdm/entity.jdm.json.hbs", {
        ...busEntity,
        attributes: (busEntity.attributes ?? []).map((a: any) =>
          stateField && (a.columnName ?? a.name) === stateField ? { ...a, required: false } : a
        ),
      });
      jdmContent = cleanJsonContent(jdmContent);
      jdmContent = JSON.stringify(normalizeJdmDecisionTables(JSON.parse(jdmContent)), null, 2);
      await fs.writeFile(
        path.join(outputDir, `src/modules/rules/jdm/${busEntity.tableName}.jdm.json`),
        jdmContent
      );
    } catch {
      console.warn(`JDM template not found for entity: ${busEntity.tableName}`);
    }
  }

  private async generateSysTables(outputDir: string, context: any): Promise<void> {
    // sys module
    const sysModuleContent = await this.renderTemplate(
      "src/modules/sys/sys.module.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "src/modules/sys/sys.module.ts"), sysModuleContent);

    // sys controller
    const sysControllerContent = await this.renderTemplate(
      "src/modules/sys/sys.controller.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/sys/sys.controller.ts"),
      sysControllerContent
    );

    // sys service
    const sysServiceContent = await this.renderTemplate(
      "src/modules/sys/sys.service.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "src/modules/sys/sys.service.ts"), sysServiceContent);

    // Entity categories — the dictionary grouping the dashboard renders by.
    await fs.mkdir(path.join(outputDir, "src/modules/sys/controllers"), { recursive: true });
    await fs.mkdir(path.join(outputDir, "src/modules/sys/services"), { recursive: true });

    const categoryServiceContent = await this.renderTemplate(
      "src/modules/sys/services/sys-category.service.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/sys/services/sys-category.service.ts"),
      categoryServiceContent
    );

    // Runtime configuration — the sys_system table behind the System
    // Configuration page. The template arrived with sys.controller,
    // sys.module and model-context.service all importing it, but nothing
    // wrote it, so `nest build` failed on three TS2307s in every generated
    // application. It is written here beside the other sys services.
    const systemConfigServiceContent = await this.renderTemplate(
      "src/modules/sys/services/system-config.service.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/sys/services/system-config.service.ts"),
      systemConfigServiceContent
    );

    const categoryControllerContent = await this.renderTemplate(
      "src/modules/sys/controllers/sys-category.controller.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/sys/controllers/sys-category.controller.ts"),
      categoryControllerContent
    );

    // The model's `%%report` questions. Written unconditionally, even for a
    // model that declares none: sys.module imports both files, so omitting them
    // when the list is empty fails `nest build` with TS2307 rather than
    // producing an application without reports.
    const reportServiceContent = await this.renderTemplate(
      "src/modules/sys/services/sys-report.service.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/sys/services/sys-report.service.ts"),
      reportServiceContent
    );

    const reportControllerContent = await this.renderTemplate(
      "src/modules/sys/controllers/sys-report.controller.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/sys/controllers/sys-report.controller.ts"),
      reportControllerContent
    );
  }

  private async generateElectricModule(outputDir: string, context: any): Promise<void> {
    const electricDir = path.join(outputDir, "src/modules/electric");
    await fs.mkdir(electricDir, { recursive: true });

    try {
      const controllerContent = await this.renderTemplate(
        "src/modules/electric/electric.controller.ts.hbs",
        context
      );
      await fs.writeFile(path.join(electricDir, "electric.controller.ts"), controllerContent);

      const moduleContent = await this.renderTemplate(
        "src/modules/electric/electric.module.ts.hbs",
        context
      );
      await fs.writeFile(path.join(electricDir, "electric.module.ts"), moduleContent);
    } catch (e) {
      console.warn("Electric module templates not found, skipping:", (e as Error).message);
    }
  }

  /**
   * Write the per-entity hook handler modules and the registry binding them.
   *
   * Handlers are where application logic goes, so a handler module is written
   * only when it does not already exist. Regenerating a project must not throw
   * away an implementation someone wrote — the registry, which is pure wiring,
   * is rewritten every time so a newly declared hook is always picked up.
   */
  private async generateHookHandlers(hooksDir: string): Promise<void> {
    const handlersDir = path.join(hooksDir, "handlers");
    await fs.mkdir(handlersDir, { recursive: true });

    const grouped = hooksByEntity(this.options.compiledHooks ?? []);
    const entities = [...grouped.keys()].sort();

    for (const entity of entities) {
      const hooks = grouped.get(entity) ?? [];
      const file = path.join(handlersDir, `${entity}.ts`);

      let existing: string | null = null;
      try {
        existing = await fs.readFile(file, "utf-8");
      } catch {
        // no handler module yet — write the stubs
      }

      if (existing === null) {
        await fs.writeFile(file, this.renderHookModule(entity, hooks));
        continue;
      }

      // The module is already there and may carry real implementations. Append
      // stubs only for handlers it does not export yet, so a hook added to the
      // model after the first generation still arrives.
      const missing = hooks.filter(
        (hook) => !new RegExp(`\\b(function|const)\\s+${hook.handler}\\b`).test(existing as string)
      );
      if (!missing.length) continue;

      const additions = missing.map((hook) => this.renderHookFunction(entity, hook)).join("\n");
      await fs.writeFile(
        file,
        `${existing.trimEnd()}\n\n/* --- Added by a later generation run --- */\n\n${additions}`
      );
    }

    await fs.writeFile(path.join(handlersDir, "index.ts"), this.renderHookRegistry(grouped));
  }

  /** One handler function: a documented no-op with the right shape. */
  private renderHookFunction(entity: string, hook: CompiledHook): string {
    const contract = HOOK_CONTRACTS[hook.type];
    const scope = hook.field ? `\n * Scoped to \`${hook.field}\`.` : "";
    const async = `export async function ${hook.handler}(${contract.param}: ${contract.paramType})`;

    const body =
      contract.returns === "void"
        ? "  // TODO: implement.\n"
        : contract.returns === "boolean"
          ? "  // TODO: implement. Return false to block the delete.\n  return true;\n"
          : `  // TODO: implement.\n  return ${contract.param};\n`;

    return (
      `/**\n * ${hook.type} on ${entity}.\n *\n * ${contract.summary}${scope}\n */\n` +
      `${async}: Promise<${contract.returns}> {\n${body}}\n`
    );
  }

  /** A whole entity's handler module. */
  private renderHookModule(entity: string, hooks: CompiledHook[]): string {
    const header =
      `/**\n * Lifecycle handlers for ${entity}.\n *\n` +
      ` * Declared by the model's \`%%hook\` directives and wired up in ./index.ts.\n` +
      ` * The bodies are yours: this file is generated once and then left alone, so\n` +
      ` * regenerating the project will not overwrite what you write here.\n */\n\n`;

    return header + hooks.map((hook) => this.renderHookFunction(entity, hook)).join("\n");
  }

  /** The registry the hooks module reads. Pure wiring, always regenerated. */
  private renderHookRegistry(grouped: Map<string, CompiledHook[]>): string {
    const entities = [...grouped.keys()].sort();

    // The identifier reaching the service is whatever the caller used — the
    // REST route sends `bus_compound`, the UI sends `chemical-inventory`, the
    // model calls it `ChemicalInventory`. Keying on any one spelling means the
    // other two silently find no hooks, so every lookup goes through the same
    // normaliser on both sides.
    const header =
      "/**\n * Hook registry.\n *\n" +
      " * Binds each entity's handlers to the lifecycle events the model declares.\n" +
      " * Generated from `%%hook` directives — edit the model, not this file.\n *\n" +
      " * @generated\n */\n\n";

    const keyFn =
      "/** Canonical lookup key for an entity, however it was spelled. */\n" +
      "export function hookKey(entity: string): string {\n" +
      "  const flat = entity.toLowerCase().replace(/^bus_/, '').replace(/[_-]/g, '');\n" +
      "  return flat.endsWith('s') && !flat.endsWith('ss') ? flat.slice(0, -1) : flat;\n" +
      "}\n\n";

    if (!entities.length) {
      return (
        `${header}${keyFn}// This model declares no \`%%hook\` directives. Add a hook to a\n` +
        "// workflow and regenerate to populate this file.\n" +
        "export const ENTITY_HOOKS: Record<string, Record<string, Record<string, any>>> = {};\n"
      );
    }

    const imports = entities
      .map((entity) => `import * as ${entity}Hooks from './${entity}';`)
      .join("\n");

    const bindings = entities
      .map((entity) => {
        const byType = new Map<string, string[]>();
        for (const hook of grouped.get(entity) ?? []) {
          const list = byType.get(hook.type);
          if (list) list.push(hook.handler);
          else byType.set(hook.type, [hook.handler]);
        }

        const events = [...byType.entries()]
          .map(([type, handlers]) => {
            const entries = handlers
              .map((handler) => `      ${handler}: ${entity}Hooks.${handler},`)
              .join("\n");
            return `    ${type}: {\n${entries}\n    },`;
          })
          .join("\n");

        return `  // ${entity}\n  [hookKey('${entity}')]: {\n${events}\n  },`;
      })
      .join("\n");

    return (
      `${header}${imports}\n\n${keyFn}` +
      "export const ENTITY_HOOKS: Record<string, Record<string, Record<string, any>>> = {\n" +
      `${bindings}\n};\n`
    );
  }

  private async generateBusEntities(outputDir: string, context: any): Promise<void> {
    // Generate hooks module first (bus.service depends on it)
    const hooksDir = path.join(outputDir, "src/modules/hooks");
    await fs.mkdir(hooksDir, { recursive: true });

    // Handler modules and the registry that binds them to entities. Written
    // before hooks.ts, which imports the registry.
    await this.generateHookHandlers(hooksDir);

    // Generate hooks.ts file
    const hooksContent = `/**
 * Hooks Index
 *
 * Runs the lifecycle handlers the model's \`%%hook\` directives declare.
 * The handlers themselves live in ./handlers, one module per entity.
 *
 * @generated
 */

import { ENTITY_HOOKS, hookKey } from './handlers';

export interface HookRegistry {
  beforeCreate?: Record<string, (...args: unknown[]) => unknown>;
  afterCreate?: Record<string, (...args: unknown[]) => unknown>;
  beforeUpdate?: Record<string, (...args: unknown[]) => unknown>;
  afterUpdate?: Record<string, (...args: unknown[]) => unknown>;
  beforeDelete?: Record<string, (...args: unknown[]) => unknown>;
  afterDelete?: Record<string, (...args: unknown[]) => unknown>;
  beforeQuery?: Record<string, (...args: unknown[]) => unknown>;
  afterQuery?: Record<string, (...args: unknown[]) => unknown>;
  customValidate?: Record<string, (...args: unknown[]) => unknown>;
  beforeRead?: Record<string, (...args: unknown[]) => unknown>;
  afterRead?: Record<string, (...args: unknown[]) => unknown>;
  beforeList?: Record<string, (...args: unknown[]) => unknown>;
  afterList?: Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Get all registered hooks for an entity
 *
 * Accepts any spelling the caller happens to use — \`Compound\`, \`compound\`,
 * \`compounds\`, \`bus_compound\` and \`chemical-inventory\` all resolve.
 */
export function getHooks(entity: string): HookRegistry {
  return ENTITY_HOOKS[hookKey(entity)] ?? {};
}

/**
 * Execute beforeCreate hooks for an entity
 */
export async function executeBeforeCreateHooks(
  entity: string,
  data: any
): Promise<any> {
  const hooks = getHooks(entity);
  const beforeHooks = hooks.beforeCreate || {};

  let result = data;
  for (const hookName of Object.keys(beforeHooks)) {
    const hookFn = beforeHooks[hookName];
    result = await hookFn(result);
  }
  return result;
}

/**
 * Execute afterCreate hooks for an entity
 */
export async function executeAfterCreateHooks(
  entity: string,
  data: any
): Promise<void> {
  const hooks = getHooks(entity);
  const afterHooks = hooks.afterCreate || {};

  for (const hookName of Object.keys(afterHooks)) {
    const hookFn = afterHooks[hookName];
    await hookFn(data);
  }
}

/**
 * Execute beforeUpdate hooks for an entity
 */
export async function executeBeforeUpdateHooks(
  entity: string,
  data: any
): Promise<any> {
  const hooks = getHooks(entity);
  const beforeHooks = hooks.beforeUpdate || {};

  let result = data;
  for (const hookName of Object.keys(beforeHooks)) {
    const hookFn = beforeHooks[hookName];
    result = await hookFn(result);
  }
  return result;
}

/**
 * Execute afterUpdate hooks for an entity
 */
export async function executeAfterUpdateHooks(
  entity: string,
  data: any
): Promise<void> {
  const hooks = getHooks(entity);
  const afterHooks = hooks.afterUpdate || {};

  for (const hookName of Object.keys(afterHooks)) {
    const hookFn = afterHooks[hookName];
    await hookFn(data);
  }
}

/**
 * Execute beforeDelete hooks for an entity
 */
export async function executeBeforeDeleteHooks(
  entity: string,
  id: string
): Promise<boolean> {
  const hooks = getHooks(entity);
  const beforeHooks = hooks.beforeDelete || {};

  for (const hookName of Object.keys(beforeHooks)) {
    const hookFn = beforeHooks[hookName];
    const result = await hookFn(id);
    if (result === false) return false;
  }
  return true;
}

/**
 * Execute afterDelete hooks for an entity
 */
export async function executeAfterDeleteHooks(
  entity: string,
  data: any
): Promise<void> {
  const hooks = getHooks(entity);
  const afterHooks = hooks.afterDelete || {};

  for (const hookName of Object.keys(afterHooks)) {
    const hookFn = afterHooks[hookName];
    await hookFn(data);
  }
}

/**
 * Execute beforeRead hooks for an entity
 */
export async function executeBeforeReadHooks(
  entity: string,
  params: any
): Promise<any> {
  const hooks = getHooks(entity);
  const beforeHooks = hooks.beforeRead || {};

  let result = params;
  for (const hookName of Object.keys(beforeHooks)) {
    const hookFn = beforeHooks[hookName];
    result = await hookFn(result);
  }
  return result;
}

/**
 * Execute afterRead hooks for an entity
 */
export async function executeAfterReadHooks(
  entity: string,
  data: any
): Promise<void> {
  const hooks = getHooks(entity);
  const afterHooks = hooks.afterRead || {};

  for (const hookName of Object.keys(afterHooks)) {
    const hookFn = afterHooks[hookName];
    await hookFn(data);
  }
}

/**
 * Execute beforeList hooks for an entity
 */
export async function executeBeforeListHooks(
  entity: string,
  params: any
): Promise<any> {
  const hooks = getHooks(entity);
  const beforeHooks = hooks.beforeList || {};

  let result = params;
  for (const hookName of Object.keys(beforeHooks)) {
    const hookFn = beforeHooks[hookName];
    result = await hookFn(result);
  }
  return result;
}

/**
 * Execute afterList hooks for an entity
 */
export async function executeAfterListHooks(
  entity: string,
  data: any[]
): Promise<void> {
  const hooks = getHooks(entity);
  const afterHooks = hooks.afterList || {};

  for (const hookName of Object.keys(afterHooks)) {
    const hookFn = afterHooks[hookName];
    await hookFn(data);
  }
}

/**
 * Execute customValidate hooks for an entity
 *
 * Runs on every create and update. A handler rejects the write by throwing;
 * the error propagates to the caller as-is so it keeps its own status code.
 */
export async function executeCustomValidateHooks(
  entity: string,
  data: any
): Promise<void> {
  const hooks = getHooks(entity);
  const validators = hooks.customValidate || {};

  for (const hookName of Object.keys(validators)) {
    const hookFn = validators[hookName];
    await hookFn(data);
  }
}
`;

    await fs.writeFile(path.join(hooksDir, "hooks.ts"), hooksContent);

    // Generate single generic bus controller and service that handles all entities dynamically
    const controllerContent = await this.renderTemplate(
      "src/modules/bus/bus.controller.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/modules/bus/bus.controller.ts"),
      controllerContent
    );

    const serviceContent = await this.renderTemplate("src/modules/bus/bus.service.ts.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/modules/bus/bus.service.ts"), serviceContent);

    // sys_window.where_clause / .order_by_clause, parsed against the entity's
    // real columns. Plain TypeScript rather than a template — it holds no model
    // data, and being a real module is what lets it be unit-tested here.
    await fs.copyFile(
      path.join(this.resolvedTemplateDir, "src/modules/bus/window-list-defaults.ts"),
      path.join(outputDir, "src/modules/bus/window-list-defaults.ts")
    );

    // Draft → final promotion pipeline
    // …and the moves a record makes after it: its action buttons.
    for (const name of [
      "entity-promotion.service",
      "promotion-dispatcher.service",
      "transition.service",
    ]) {
      const content = await this.renderTemplate(`src/modules/bus/${name}.ts.hbs`, context);
      await fs.writeFile(path.join(outputDir, `src/modules/bus/${name}.ts`), content);
    }

    // Bus module
    const busModuleContent = await this.renderTemplate(
      "src/modules/bus/bus.module.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "src/modules/bus/bus.module.ts"), busModuleContent);
  }

  private async generateMigrations(outputDir: string, context: any): Promise<void> {
    const migrationsDir = path.join(outputDir, "src/migrations");

    // Select database-specific migration templates
    const dbType = this.options.databaseType;
    const sysMigrationTemplate =
      dbType === "sqlite"
        ? "../../common/migrations/sys-tables.sqlite.migration.ts.hbs"
        : "../../common/migrations/sys-tables.migration.ts.hbs";
    const busMigrationTemplate =
      dbType === "sqlite"
        ? "../../common/migrations/bus-tables.sqlite.migration.ts.hbs"
        : "../../common/migrations/bus-tables.migration.ts.hbs";

    // The scaffold migrations, in execution order.
    //
    // Names are deterministic (a fixed zero-padded sequence, never a timestamp)
    // so that regenerating over an existing project overwrites each file in
    // place. Timestamped names made every `--force` regeneration emit a *new*
    // set of files alongside the old ones: the migration runner keys off the
    // filename, so it replayed CREATE TABLE migrations that had already run.
    //
    // The sequence sorts before the `<Date.now()>_add_<entity>.ts` additive
    // migrations that `generate:entity` writes, which is the order the runner
    // needs — scaffold first, then per-entity additions.
    const scaffold: Array<{ slug: string; template: string; required?: boolean }> = [
      // auth tables must run before sys/bus tables
      {
        slug: "create_auth_tables",
        template: "src/migrations/000_create_auth_tables.ts.hbs",
        required: true,
      },
      { slug: "create_sys_tables", template: sysMigrationTemplate, required: true },
      // creates all business entity tables
      { slug: "create_bus_tables", template: busMigrationTemplate, required: true },
      // adds sys_workflow_runs + doc_status columns to bus tables
      { slug: "add_workflow_support", template: "src/migrations/003_add_workflow_support.ts.hbs" },
      {
        slug: "create_workflow_definitions",
        template: "src/migrations/004_create_workflow_definitions.ts.hbs",
      },
      // corrects any DECIMAL columns mistyped as VARCHAR
      {
        slug: "fix_numeric_columns",
        template: "../../common/migrations/fix_numeric_columns.migration.ts.hbs",
      },
      // sys_category — entity grouping for the dashboard and admin dictionary.
      // Must run after sys_table exists, since it adds the FK column to it.
      { slug: "create_sys_category", template: "src/migrations/005_create_sys_category.ts.hbs" },
      // audit_log — immutable trail of every mutation, read by /admin/audit
      { slug: "create_audit_log", template: "src/migrations/006_create_audit_log.ts.hbs" },
      // mermaid_code + kind on sys_workflow_definitions, so an automation the
      // builder writes can be stored at all — before this, bpmn_xml was NOT NULL.
      {
        slug: "add_automation_definitions",
        template: "src/migrations/008_add_automation_definitions.ts.hbs",
      },
      // trigger_type / source / workflow_name. Also declared in 004's
      // createTable for a fresh database; repeated here because the runner
      // tracks by filename, so an app generated before those columns existed
      // has already recorded 004 as executed and would never receive them.
      {
        slug: "add_workflow_ownership",
        template: "src/migrations/007_add_workflow_ownership.ts.hbs",
      },
      // Reconcile the auth tables with the installed Better Auth version. Runs
      // before the seed, which creates the demo accounts those tables hold.
      {
        slug: "sync_better_auth_schema",
        template: "src/migrations/010_sync_better_auth_schema.ts.hbs",
      },
      // allowed_roles on the dictionary tables — what an Electric shape filters
      // on so a client syncs only the part of the Application Dictionary its
      // role may see. Must run after sys_access and every dictionary table
      // exists, since it derives the column from them.
      {
        slug: "add_dictionary_role_scope",
        template: "src/migrations/009_add_dictionary_role_scope.ts.hbs",
      },
      // sys_operation_access — what `%%rbac` compiles to. Deliberately separate
      // from sys_access, which is a grant table feeding the dictionary scope:
      // a row there narrows which roles may see a window, which is not what a
      // restriction on deleting means.
      {
        slug: "add_operation_access",
        template: "src/migrations/011_add_operation_access.ts.hbs",
      },
      // sys_workflow_transitions — the edges a `%%workflow … kind: state` diagram
      // draws. The entity-access guard reads this table to refuse a write that
      // moves a record to a state with no incoming edge from its current one.
      // Without it seeded, every transition is allowed and the state machine is
      // decorative.
      {
        slug: "add_workflow_transitions",
        template: "src/migrations/012_add_workflow_transitions.ts.hbs",
      },
      // sys_report_designs — the per-entity document report layouts the admin
      // report designer saves. Without it, /admin/reports cannot store a layout.
      {
        slug: "add_report_designs",
        template: "src/migrations/013_add_report_designs.ts.hbs",
      },
      // sys_note — the notes people leave on a record, shown above its history
      {
        slug: "add_record_notes",
        template: "src/migrations/014_add_record_notes.ts.hbs",
      },
      // sys_system — database-backed config (AI, features, rate limits, app identity)
      {
        slug: "add_system_config",
        template: "src/migrations/015_add_system_config.ts.hbs",
      },
      // sys_window.where_clause / .order_by_clause — which rows a list shows and
      // in what order, decided in the dictionary. Backfills every existing
      // window with `updated_at DESC` so a list opens on the most recent change.
      {
        slug: "add_window_list_defaults",
        template: "src/migrations/016_add_window_list_defaults.ts.hbs",
      },
      // sys_notification_read — which transaction notifications a user has
      // already seen. The notifications themselves are read from audit_log;
      // only the read mark is stored, because "seen" is not a property of an
      // append-only trail.
      {
        slug: "add_notification_reads",
        template: "src/migrations/017_add_notification_reads.ts.hbs",
      },
      // sys_report — what `%%report` compiles to. Not to be confused with
      // sys_report_designs (013), which is the per-entity document layout the
      // Print button renders; this is the model's analytical questions and the
      // SQL that answers each of them.
      {
        slug: "add_reports",
        template: "src/migrations/018_add_reports.ts.hbs",
      },
      // sys_window.icon (new) and sys_table.icon (widened to TEXT) — an icon is
      // dictionary data, and it may be a lucide name or an uploaded image.
      // Without the window column the dashboard gated its admin cards on a
      // hard-coded map and dropped any window the map did not name.
      {
        slug: "add_dictionary_icons",
        template: "src/migrations/019_add_dictionary_icons.ts.hbs",
      },
      // A rule's display title, beside the identifier it is filed under.
      {
        slug: "add_rule_title",
        template: "src/migrations/020_add_rule_title.ts.hbs",
      },
      // The Field window's Reference Type Override gets its column; X and Y
      // Position go — Sequence, Same Line and Column Span lay a form out.
      {
        slug: "field_dictionary",
        template: "src/migrations/021_field_dictionary.ts.hbs",
      },
      // The record lifecycle: one grant table (the two access tables become
      // views over it), the one-join capability view, the transition log and
      // the assignee columns.
      {
        slug: "record_lifecycle",
        template: "src/migrations/022_record_lifecycle.ts.hbs",
        required: true,
      },
      // A status flow an administrator redraws in Rules and workflows: the
      // compiled lifecycle stored with the diagram, and a notification so
      // every backend instance runs the new one on its next request.
      {
        slug: "editable_lifecycles",
        template: "src/migrations/023_editable_lifecycles.ts.hbs",
        required: true,
      },
      // A workflow bound to a status is stored as ENTER:<STATE>, which the
      // original varchar(20) of the operation column cannot hold.
      {
        slug: "widen_workflow_operation",
        template: "src/migrations/024_widen_workflow_operation.ts.hbs",
        required: true,
      },
    ];

    // Drop previously generated scaffold migrations under *any* prefix. This
    // clears out the timestamped files older generator versions produced, so a
    // regenerated project is left with exactly one copy of each migration.
    const scaffoldSlugs = new Set(scaffold.map((m) => m.slug));
    try {
      for (const file of await fs.readdir(migrationsDir)) {
        const match = file.match(/^\d+_(.+)\.ts$/);
        if (match?.[1] && scaffoldSlugs.has(match[1])) {
          await fs.unlink(path.join(migrationsDir, file));
        }
      }
    } catch (_e) {
      // Directory may not exist yet, that's fine
    }

    await fs.mkdir(migrationsDir, { recursive: true });

    for (const [index, { slug, template, required }] of scaffold.entries()) {
      const fileName = `${String(index).padStart(4, "0")}_${slug}.ts`;
      try {
        const content = await this.renderTemplate(template, context);
        await fs.writeFile(path.join(migrationsDir, fileName), content);
      } catch (e) {
        if (required) throw e;
        console.warn(`Migration template not found, skipping ${slug}:`, (e as Error).message);
      }
    }

    // Seed users and roles with Better-Auth integration
    try {
      const usersAndRolesContent = await this.renderTemplate(
        "../../common/seeds/users-and-roles.ts.hbs",
        context
      );
      await fs.writeFile(path.join(outputDir, "seeds/00_users_and_roles.ts"), usersAndRolesContent);
    } catch (e) {
      console.warn("Users and roles seed template failed, skipping:", (e as Error).message);
    }

    // Seed sys_reference data
    const sysRefContent = await this.renderTemplate(
      "../../common/seeds/sys-references.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "seeds/01_sys_references.ts"), sysRefContent);

    // Seed sys_dictionary data (sys_table, sys_column, sys_field)
    const sysDictContent = await this.renderTemplate(
      "../../common/seeds/sys-dictionary.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "seeds/02_sys_dictionary.ts"), sysDictContent);

    // Seed entity categories. Numbered 02b so it runs straight after the
    // dictionary that creates the sys_table rows it assigns.
    try {
      const categoriesContent = await this.renderTemplate(
        "../../common/seeds/entity-categories.ts.hbs",
        context
      );
      await fs.writeFile(path.join(outputDir, "seeds/02b_entity_categories.ts"), categoriesContent);
    } catch (e) {
      console.warn("Entity categories seed template failed, skipping:", (e as Error).message);
    }

    // Seed business data for E2E testing. A state machine's move facts — the
    // `<state>_at` column a person records to move a record along an edge — are
    // left empty: filled with timestamps, the first edit of any seeded row
    // matched every move at once, and with the rule's `collect` hit policy the
    // last to run won (a prospecting opportunity jumped to closed_lost).
    const businessDataContent = await this.renderTemplate(
      "../../common/seeds/business-data.ts.hbs",
      this.withMoveFacts(context)
    );
    await fs.writeFile(path.join(outputDir, "seeds/03_business_data.ts"), businessDataContent);

    // Seed business rules (JDM decision models) into sys_rule_definitions
    try {
      const businessRulesContent = await this.renderTemplate(
        "../../common/seeds/business-rules.ts.hbs",
        context
      );
      await fs.writeFile(path.join(outputDir, "seeds/04_business_rules.ts"), businessRulesContent);
    } catch (e) {
      console.warn("Business rules seed template failed, skipping:", (e as Error).message);
    }

    // Seed the model's %%rbac rules into sys_operation_access. Numbered 04b so
    // it runs with the other model-declared policy; it creates any role the
    // directives name that the users seed did not.
    try {
      const operationAccessContent = await this.renderTemplate(
        "../../common/seeds/operation-access.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "seeds/04b_operation_access.ts"),
        operationAccessContent
      );
    } catch (e) {
      console.warn("Operation access seed template failed, skipping:", (e as Error).message);
    }

    // Seed workflow definitions. Runs after 04 because the trigger rules seeded
    // there are what go looking for these by name.
    await fs.writeFile(
      path.join(outputDir, "seeds/05_workflow_definitions.ts"),
      this.renderWorkflowDefinitionsSeed(context)
    );

    // Seed valid state-machine transitions into sys_workflow_transitions so
    // the entity-access guard can enforce topology (not just role access).
    await fs.writeFile(
      path.join(outputDir, "seeds/05b_workflow_transitions.ts"),
      this.renderWorkflowTransitionsSeed(context)
    );

    // The state field of every entity with a state machine, and the state a new
    // record starts in. The guard reads it to refuse a person's write to that
    // column, and the bus service to start a new record in its initial state.
    await fs.mkdir(path.join(outputDir, "src/common"), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "src/common/state-fields.ts"),
      this.renderStateFields(context)
    );
    // Every table's lifecycle — Draft, the status flow, Final — which the bus
    // service, the transition service and the access guard all read.
    await fs.writeFile(
      path.join(outputDir, "src/common/lifecycle.ts"),
      this.renderLifecycle(context)
    );
    // Every cache's expiry, read from .env (CACHE_TTL_<NAME>_MS).
    await fs.copyFile(
      path.join(this.resolvedTemplateDir, "src/common/ttl-cache.ts"),
      path.join(outputDir, "src/common/ttl-cache.ts")
    );

    // Field logic — the bus service enforces mandatory and read-only logic on
    // every write, and the sys service refuses a condition that does not parse.
    // The same module the checker and the front end read (templates/common).
    await fs.copyFile(
      path.join(this.resolvedTemplateDir, "../../common/field-logic.ts"),
      path.join(outputDir, "src/common/field-logic.ts")
    );
    // Default Value, read as the form reads it, so a record created through the
    // API starts with what the form would have shown.
    await fs.copyFile(
      path.join(this.resolvedTemplateDir, "../../common/field-values.ts"),
      path.join(outputDir, "src/common/field-values.ts")
    );

    // Cascading lookups: which reference fields wait for another, with any circular
    // wait broken so a form can always be started (Portfolio: household / risk profile).
    await fs.copyFile(
      path.join(this.resolvedTemplateDir, "../../common/cascade-lookups.ts"),
      path.join(outputDir, "src/common/cascade-lookups.ts")
    );

    // Seed default AnkaReport layouts for every entity into sys_report_designs.
    const reportDesignsSeedContent = await this.renderTemplate(
      "../../common/seeds/report-designs.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "seeds/06_report_designs.ts"),
      reportDesignsSeedContent
    );

    // Seed system configuration rows into sys_system.
    const systemConfigContent = await this.renderTemplate(
      "../../common/seeds/system-config.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "seeds/07_system_config.ts"), systemConfigContent);

    // Seed the model's own `%%report` questions into sys_report. Last, because
    // the queries read the business tables every seed before it has filled.
    await fs.writeFile(
      path.join(outputDir, "seeds/08_reports.ts"),
      this.renderReportsSeed(context)
    );
  }

  /**
   * The workflow-definitions seed.
   *
   * Every entity gets a `trigger-workflow` rule on create and on update, each
   * naming a definition. Without the definitions the service logged "No active
   * workflow named … — nothing to trigger" on every single write and no run was
   * ever recorded. Entities with a state machine in the model get a definition
   * that puts a new record into its starting state; the rest get a pass-through
   * so the run still exists and the chain is observable.
   */
  private renderWorkflowDefinitionsSeed(context: any): string {
    const byEntity = new Map<string, CompiledWorkflow>();
    for (const workflow of this.options.compiledWorkflows ?? []) {
      if (!byEntity.has(workflow.entity)) byEntity.set(workflow.entity, workflow);
    }

    const rows: string[] = [];
    for (const entity of context.entities ?? []) {
      const tableName: string = entity.tableName;
      const workflow = byEntity.get(entity.name) ?? byEntity.get(entity.className);

      // Status lives on whichever column the model gave the entity; `status` is
      // the conventional one, `workflow_status` the fallback every bus table has.
      const columns: string[] = (entity.attributes ?? []).map((a: any) => a.columnName ?? a.name);
      const statusField = stateFieldOf(columns) ?? "workflow_status";

      const description = workflow
        ? describeWorkflow(workflow)
        : `No state machine declared for ${entity.displayName ?? tableName}.`;

      for (const operation of ["create", "update"]) {
        // The state-entry task belongs to CREATE alone. Seeding it for UPDATE
        // too meant every update re-asserted the machine's *initial* state, so
        // the write that moved a record forward was immediately undone: a lead
        // set to "qualified" came back "new", and the conversion workflow that
        // had just set it to "converted" was overwritten by the same reset.
        // Status was effectively read-only in any generated application whose
        // model declared a state machine.
        //
        // On update the definition is a pass-through, so the run is still
        // created and visible in the run list — the transitions the model
        // declares constrain what an update may do, and nothing here should be
        // deciding the state on the record's behalf.
        const bpmn =
          workflow && operation === "create"
            ? buildStateEntryBpmn(workflow, tableName, statusField)
            : buildPassThroughBpmn(tableName);

        rows.push(
          `  {\n` +
            `    name: '${tableName}-on-${operation}-workflow',\n` +
            `    entityName: '${tableName}',\n` +
            `    operation: '${operation.toUpperCase()}',\n` +
            `    triggerType: 'automatic',\n` +
            `    description: '${jsQuote(description)}',\n` +
            `    bpmnXml: ${JSON.stringify(bpmn)},\n` +
            `  },`
        );
      }
    }

    // Saga workflows are named by the model, not by convention, so they are
    // extra definitions rather than replacements for the per-entity pair.
    const tableFor = new Map<string, string>();
    for (const entity of context.entities ?? []) {
      const table: string = entity.tableName;
      // A %%step may name the entity however the model spells it, or use the
      // table name directly; all of them have to land on the same table.
      for (const spelling of [entity.name, entity.className, table, table.replace(/^bus_/, "")]) {
        if (spelling) tableFor.set(String(spelling).toLowerCase(), table);
      }
    }
    const resolveTable = (entity: string) => tableFor.get(entity.trim().toLowerCase()) ?? entity;

    for (const saga of this.options.compiledSagas ?? []) {
      const tableName = tableFor.get(saga.entity.toLowerCase());
      if (!tableName) continue;

      rows.push(
        `  {\n` +
          `    name: '${jsQuote(saga.name)}',\n` +
          `    entityName: '${tableName}',\n` +
          `    operation: '${saga.operation}',\n` +
          `    triggerType: '${saga.trigger}',\n` +
          `    description: '${jsQuote(describeSaga(saga))}',\n` +
          `    bpmnXml: ${JSON.stringify(buildSagaBpmn(saga, tableName, resolveTable))},\n` +
          `  },`
      );
    }

    return `/**
 * Workflow definitions.
 *
 * Generated from the model's \`%%workflow\` sections. The trigger-workflow rules
 * seeded in 04 resolve definitions by name, so there is one per entity per
 * operation, plus one for every \`kind: saga\` workflow the model declares.
 *
 * These rows are owned by the model: they carry \`source = 'model'\` and are
 * rewritten on every generation. Workflows built in the app carry
 * \`source = 'designer'\` and are never touched here.
 *
 * @generated — edit the model, not this file.
 */

import type { Kysely } from 'kysely';

const DEFINITIONS = [
${rows.join("\n")}
];

export async function seed(db: Kysely<any>): Promise<void> {
  for (const definition of DEFINITIONS) {
    const existing = await db
      .selectFrom('sys_workflow_definitions')
      .select(['id', 'source'])
      .where('name', '=', definition.name)
      .executeTakeFirst();

    if (existing) {
      // A definition someone built in the Workflow Designer is theirs. Seeding
      // over it would silently discard their work every time the project is
      // regenerated, and the name collision is far more likely to be an
      // accident than an instruction to overwrite.
      if (existing.source === 'designer') {
        console.log(
          \`  ⤳ Skipped workflow definition: \${definition.name} — a designer-authored workflow already has that name\`,
        );
        continue;
      }

      await db
        .updateTable('sys_workflow_definitions')
        .set({
          entity_name: definition.entityName,
          operation: definition.operation,
          bpmn_xml: definition.bpmnXml,
          description: definition.description,
          trigger_type: definition.triggerType,
          source: 'model',
          is_active: true,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .execute();
      console.log(\`  ↻ Updated workflow definition: \${definition.name}\`);
      continue;
    }

    await db
      .insertInto('sys_workflow_definitions')
      .values({
        name: definition.name,
        entity_name: definition.entityName,
        operation: definition.operation,
        bpmn_xml: definition.bpmnXml,
        description: definition.description,
        trigger_type: definition.triggerType,
        source: 'model',
        is_active: true,
      })
      .execute();
    console.log(\`  ✓ Seeded workflow definition: \${definition.name}\`);
  }
}
`;
  }

  /**
   * Update/enhance configuration files created by NestJS CLI
   */
  /**
   * Seed all valid state-machine transitions from `%%workflow … kind: state`
   * into `sys_workflow_transitions`. The entity-access guard reads this table
   * to refuse a status-field write that has no matching edge from the record's
   * current state — enforcing the topology, not just who may cross an edge.
   */
  /**
   * `src/common/state-fields.ts`: table → its state field and initial state.
   *
   * The state field is system-managed (language/state-field.ts): no person
   * writes it through /bus, a new record starts in the machine's initial state,
   * and only background workflows — saga steps, rules, hooks — move it. Written
   * as a module rather than read from sys_workflow_transitions because the
   * initial edge (`[*] --> x`) is not a row there, and the answer must not
   * depend on a seed having run.
   */
  /**
   * The seed context with each entity's move-fact columns marked
   * (`attribute.isMoveFact`): `<state>_at` for every state its state machine
   * declares. The seed writes them as null; the record's state is seeded on its
   * own, and its history of moves is simply not recorded.
   */
  private withMoveFacts(context: any): any {
    const byEntity = new Map<string, CompiledWorkflow>();
    for (const workflow of this.options.compiledWorkflows ?? []) {
      if (!byEntity.has(workflow.entity)) byEntity.set(workflow.entity, workflow);
    }
    const entities = (context.entities ?? []).map((entity: any) => {
      const workflow = byEntity.get(entity.name) ?? byEntity.get(entity.className);
      if (!workflow) return entity;
      const facts = new Set(workflow.states.map((state) => `${state.name}_at`));
      return {
        ...entity,
        attributes: (entity.attributes ?? []).map((attribute: any) =>
          // A column the model requires is the model's own fact, not a stamp of a
          // move: `SafeguardingConcern.reported_at` (required) beside a state
          // called `reported` was nulled by the seed, and the NOT NULL it asked
          // for refused the insert — seed 03 failed and the app never started.
          facts.has(attribute.columnName ?? attribute.name) && !attribute.required
            ? { ...attribute, isMoveFact: true }
            : attribute
        ),
      };
    });
    return { ...context, entities };
  }

  private renderStateFields(context: any): string {
    const byEntity = new Map<string, CompiledWorkflow>();
    for (const workflow of this.options.compiledWorkflows ?? []) {
      if (!byEntity.has(workflow.entity)) byEntity.set(workflow.entity, workflow);
    }
    const rows: string[] = [];
    for (const entity of context.entities ?? []) {
      const workflow = byEntity.get(entity.name) ?? byEntity.get(entity.className);
      if (!workflow) continue;
      const columns: string[] = (entity.attributes ?? []).map((a: any) => a.columnName ?? a.name);
      const field = stateFieldOf(columns) ?? "workflow_status";
      const initial = workflow.initial ? `'${workflow.initial}'` : "null";
      rows.push(`  ${entity.tableName}: { field: '${field}', initial: ${initial} },`);
    }
    return [
      `/**`,
      ` * The state field of every entity with a state machine — generated from the`,
      ` * model, do not edit.`,
      ` *`,
      ` * A state field is never changed by a person through a form or a direct API`,
      ` * write: only background workflows (saga steps, rules, hooks) change it, and a`,
      ` * new record starts in its machine's initial state. The form shows it`,
      ` * read-only in the record header and the list grid always shows it.`,
      ` */`,
      `export interface StateField {`,
      `  /** The column the state machine drives. */`,
      `  field: string;`,
      `  /** The state a new record starts in — the \`[*] --> x\` edge. */`,
      `  initial: string | null;`,
      `}`,
      ``,
      `export const STATE_FIELDS: Readonly<Record<string, StateField>> = {`,
      ...rows,
      `};`,
      ``,
      `/** \`details.code\` of the refusal a person's write to a state field receives. */`,
      `export const STATE_FIELD_REFUSAL_CODE = '${STATE_FIELD_REFUSAL_CODE}';`,
      ``,
      `/** The state field of a \`bus_\` table, or undefined when it has no state machine. */`,
      `export function stateFieldOf(tableName: string): StateField | undefined {`,
      `  return STATE_FIELDS[tableName];`,
      `}`,
      ``,
    ].join("\n");
  }

  /**
   * `src/common/lifecycle.ts`: every business table's lifecycle.
   *
   * One statement of what language/state-field.ts defines, per table: the column
   * the lifecycle is stored in, the value Draft is stored as, where a successful
   * save goes, the Final values, and the drawn edges a button may move along. Who
   * may press one is not here — that is `sys_access_grant`, which an
   * administrator can change without regenerating.
   */
  private renderLifecycle(context: any): string {
    return renderLifecycleModule(context.entities ?? [], this.options.compiledWorkflows ?? []);
  }

  private renderWorkflowTransitionsSeed(context: any): string {
    const byEntity = new Map<string, CompiledWorkflow>();
    for (const workflow of this.options.compiledWorkflows ?? []) {
      if (!byEntity.has(workflow.entity)) byEntity.set(workflow.entity, workflow);
    }

    const rows: string[] = [];
    for (const entity of context.entities ?? []) {
      const workflow = byEntity.get(entity.name) ?? byEntity.get(entity.className);
      if (!workflow || workflow.transitions.length === 0) continue;

      const columns: string[] = (entity.attributes ?? []).map((a: any) => a.columnName ?? a.name);
      const statusField = stateFieldOf(columns) ?? "workflow_status";

      for (const t of workflow.transitions) {
        if (t.from === "[*]" || t.to === "[*]") continue; // initial/terminal not stored
        rows.push(
          `  {
` +
            `    tableName: '${entity.tableName}',
` +
            `    statusField: '${statusField}',
` +
            `    fromState: '${t.from}',
` +
            `    toState: '${t.to}',
` +
            `    transitionName: '${t.trigger ?? ""}',
` +
            `  },`
        );
      }
    }

    if (rows.length === 0) {
      return (
        `// No state-machine workflows in this model — sys_workflow_transitions will be empty.\n` +
        `import type { Kysely } from 'kysely';\n` +
        `export async function seed(_db: Kysely<any>): Promise<void> {}\n`
      );
    }

    return [
      `import { sql, type Kysely } from 'kysely';`,
      ``,
      `const TRANSITIONS = [`,
      ...rows,
      `] as const;`,
      ``,
      `export async function seed(db: Kysely<any>): Promise<void> {`,
      // No empty-list guard here: this branch is only reached with rows, and
      // `as const` gives `TRANSITIONS.length` a literal type, so comparing it
      // to 0 is `TS2367` in the generated backend's own build. The empty case
      // returns the no-op module above.
      `  // Replace the model's transitions on each table — except a table whose`,
      `  // flow an administrator redrew in Rules and workflows (a kind = 'state'`,
      `  // definition): its edges are the administrator's, and the seed runs on`,
      `  // every start.`,
      `  const redrawn = new Set(`,
      `    (await sql<{ entity_name: string }>\`SELECT entity_name FROM sys_workflow_definitions WHERE kind = 'state'\``,
      `      .execute(db)`,
      `      .then((result) => result.rows.map((row) => row.entity_name))`,
      `      .catch(() => [] as string[]))`,
      `  );`,
      `  const tables = [...new Set(TRANSITIONS.map((t) => t.tableName))].filter((tbl) => !redrawn.has(tbl));`,
      `  for (const tbl of tables) {`,
      `    await sql\``,
      `      DELETE FROM sys_workflow_transitions`,
      `      WHERE table_name = \${tbl}`,
      `    \`.execute(db);`,
      `  }`,
      `  for (const t of TRANSITIONS) {`,
      `    if (redrawn.has(t.tableName)) continue;`,
      `    await db`,
      `      .insertInto('sys_workflow_transitions')`,
      `      .values({`,
      `        table_name: t.tableName,`,
      `        status_field: t.statusField,`,
      `        from_state: t.fromState,`,
      `        to_state: t.toState,`,
      `        transition_name: t.transitionName || null,`,
      `        is_active: true,`,
      `      })`,
      `      .onConflict((oc) =>`,
      `        oc.constraint('sys_workflow_transitions_unique').doUpdateSet({`,
      `          transition_name: t.transitionName || null,`,
      `          is_active: true,`,
      `        })`,
      `      )`,
      `      .execute();`,
      `  }`,
      `}`,
    ].join("\n");
  }

  /**
   * Seed the model's `%%report` questions into `sys_report`.
   *
   * Each report's `entity:` is resolved to a table here rather than in the
   * generated application, for the same reason the transitions seed resolves
   * its status field here: the generator is the only place that holds both the
   * model's names and the names the schema ended up with. A report naming an
   * entity the model does not declare has already been ungrouped by the
   * compiler, so `entity_name` is either resolvable or absent.
   *
   * Values go through `JSON.stringify` rather than into a quoted literal. The
   * SQL is prose from a `.eml.mmd` file and routinely contains apostrophes —
   * `WHERE c.status = 'active'` is the common case, not the exotic one — and a
   * single-quoted template would produce a seed file that does not parse.
   */
  private renderReportsSeed(context: any): string {
    const reports = this.options.compiledReports ?? [];

    if (reports.length === 0) {
      return (
        `// No %%report directives in this model — sys_report will be empty, and\n` +
        `// the reports screen says so rather than showing an empty table.\n` +
        `import type { Kysely } from 'kysely';\n` +
        `export async function seed(_db: Kysely<any>): Promise<void> {}\n`
      );
    }

    // Both spellings, because a `%%report entity:` names the entity as the ERD
    // block does and the seeds elsewhere key off className.
    const tableByEntity = new Map<string, string>();
    for (const entity of context.entities ?? []) {
      if (entity.name) tableByEntity.set(entity.name, entity.tableName);
      if (entity.className) tableByEntity.set(entity.className, entity.tableName);
    }

    const rows = reports.map((report, index) => {
      const value = {
        name: report.name,
        title: report.title,
        entity_name: report.entity ?? null,
        table_name: (report.entity && tableByEntity.get(report.entity)) || null,
        chart: report.chart ?? null,
        x_axis: report.x ?? null,
        y_axis: report.y ?? null,
        help: report.help ?? null,
        sql_text: report.sql,
        sort_order: index,
      };
      return `  ${JSON.stringify(value)},`;
    });

    return [
      `import type { Kysely } from 'kysely';`,
      ``,
      `/**`,
      ` * The questions this model declared with %%report.`,
      ` *`,
      ` * Replaced on every seed rather than merged: the model is the source of`,
      ` * truth for what these say, so a report edited in the database and then`,
      ` * re-seeded should come back as the model declares it. Reports added in the`,
      ` * application are not in this list and are left alone.`,
      ` */`,
      `const REPORTS = [`,
      ...rows,
      `];`,
      ``,
      `export async function seed(db: Kysely<any>): Promise<void> {`,
      `  for (const report of REPORTS) {`,
      `    await db`,
      `      .insertInto('sys_report')`,
      `      .values({ ...report, updated_at: new Date() })`,
      `      .onConflict((oc) =>`,
      `        oc.constraint('sys_report_name_unique').doUpdateSet({`,
      `          title: report.title,`,
      `          entity_name: report.entity_name,`,
      `          table_name: report.table_name,`,
      `          chart: report.chart,`,
      `          x_axis: report.x_axis,`,
      `          y_axis: report.y_axis,`,
      `          help: report.help,`,
      `          sql_text: report.sql_text,`,
      `          sort_order: report.sort_order,`,
      `          updated_at: new Date(),`,
      `        })`,
      `      )`,
      `      .execute();`,
      `  }`,
      `  console.log(\`  ✓ \${REPORTS.length} report\${REPORTS.length === 1 ? '' : 's'} seeded\`);`,
      `}`,
    ].join("\n");
  }

  private async updateConfigFiles(outputDir: string, context: any): Promise<void> {
    // Update package.json with additional dependencies
    const packageJsonContent = await this.renderTemplate("package.json.hbs", context);
    await fs.writeFile(
      path.join(outputDir, "package.json"),
      typeof packageJsonContent === "string"
        ? packageJsonContent
        : JSON.stringify(packageJsonContent, null, 2)
    );

    // Update tsconfig.json
    try {
      const tsconfigContent = await this.renderTemplate("tsconfig.json.hbs", context);
      await fs.writeFile(path.join(outputDir, "tsconfig.json"), tsconfigContent);
    } catch (_e) {
      console.warn("Custom tsconfig template not found, keeping NestJS default");
    }

    // nest-cli.json — ensures JDM rule files are copied to dist as build assets
    try {
      const nestCliContent = await this.renderTemplate("nest-cli.json.hbs", context);
      await fs.writeFile(path.join(outputDir, "nest-cli.json"), nestCliContent);
    } catch (_e) {
      console.warn("nest-cli.json template not found, keeping NestJS default");
    }

    // .prettierrc — render from template (static content, no Handlebars vars)
    try {
      const prettierContent = await this.renderTemplate(".prettierrc.hbs", context);
      await fs.writeFile(path.join(outputDir, ".prettierrc"), prettierContent);
    } catch (_e) {
      console.warn(".prettierrc template not found, skipping");
    }

    // bunfig.toml — bun path alias config
    try {
      const bunfigContent = await this.renderTemplate("bunfig.toml.hbs", context);
      await fs.writeFile(path.join(outputDir, "bunfig.toml"), bunfigContent);
    } catch {
      console.warn("bunfig.toml template not found, skipping");
    }

    // Static NestJS boilerplate config files (not project-specific)
    const staticConfigFiles = [
      "tsconfig.build.json",
      "eslint.config.mjs",
      "test/jest-e2e.json",
      "test/app.e2e-spec.ts",
      "run-app.sh",
    ];
    await fs.mkdir(path.join(outputDir, "test"), { recursive: true });
    for (const file of staticConfigFiles) {
      try {
        await fs.copyFile(path.join(this.resolvedTemplateDir, file), path.join(outputDir, file));
        // A script keeps its execute bit whatever mode the template was
        // checked in with. Best-effort: Windows filesystems reject chmod.
        if (file.endsWith(".sh")) await fs.chmod(path.join(outputDir, file), 0o755).catch(() => {});
      } catch (_e) {
        console.warn(`Static config file not found: ${file}`);
      }
    }

    // Dockerfile — rendered from template
    try {
      const dockerfileContent = await this.renderTemplate("Dockerfile.hbs", context);
      await fs.writeFile(path.join(outputDir, "Dockerfile"), dockerfileContent);
    } catch (_e) {
      console.warn("Dockerfile template not found, skipping");
    }

    // Generate src/migrate.ts (Kysely migration runner)
    const migrateContent = await this.renderTemplate("src/migrate.ts.hbs", context);
    await fs.writeFile(path.join(outputDir, "src", "migrate.ts"), migrateContent);

    // Generate src/seed.ts (Kysely seed runner)
    const seedRunnerContent = await this.renderTemplate("src/seed.ts.hbs", context);
    await fs.writeFile(path.join(outputDir, "src", "seed.ts"), seedRunnerContent);

    // `.env.example` is generated output and always rewritten. `.env` is the
    // developer's — it holds the real DATABASE_URL, secrets and keys — so it is
    // only created when absent. Writing both unconditionally meant every
    // regeneration silently reset the connection string to the template default,
    // and the next `db:setup` failed against a database that was never the one
    // being worked on.
    const envContent = await this.renderTemplate(".env.example.hbs", context);
    await fs.writeFile(path.join(outputDir, ".env.example"), envContent);

    const envPath = path.join(outputDir, ".env");
    try {
      await fs.access(envPath);
      console.log("  ↷ Kept existing backend/.env (see .env.example for new keys)");
    } catch {
      await fs.writeFile(envPath, envContent);
    }


    // Database module
    const dbModuleContent = await this.renderTemplate(
      "src/database/database.module.ts.hbs",
      context
    );
    await fs.writeFile(path.join(outputDir, "src/database/database.module.ts"), dbModuleContent);

    // Database constants
    const dbConstantsContent = await this.renderTemplate(
      "src/database/database.constants.ts.hbs",
      context
    );
    await fs.writeFile(
      path.join(outputDir, "src/database/database.constants.ts"),
      dbConstantsContent
    );

    // Database service
    try {
      const dbServiceContent = await this.renderTemplate(
        "src/database/database.service.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/database/database.service.ts"),
        dbServiceContent
      );
    } catch (_e) {
      console.warn("Database service template not found");
    }

    // Database service decorator
    try {
      const dbServiceDecoratorContent = await this.renderTemplate(
        "src/database/database.service.decorator.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "src/database/database.service.decorator.ts"),
        dbServiceDecoratorContent
      );
    } catch (_e) {
      console.warn("Database service decorator template not found");
    }
  }

  private async generateTestFiles(outputDir: string, context: any): Promise<void> {
    try {
      // Test setup file
      const setupContent = await this.renderTemplate("test/setup.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "test/setup.ts"), setupContent);

      // CRUD test file
      const crudTestContent = await this.renderTemplate("test/crud.test.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "test/crud.test.ts"), crudTestContent);

      // Vitest configuration
      const vitestContent = await this.renderTemplate("vitest.config.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "vitest.config.ts"), vitestContent);
    } catch (e) {
      // Test templates may not exist, skip — but surface the actual reason so
      // template rendering errors are not silently swallowed
      console.warn(`Test generation skipped: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Auth tests
    const authTestFiles = [
      {
        tpl: "test/modules/auth/auth.controller.test.ts.hbs",
        out: "test/modules/auth/auth.controller.test.ts",
      },
      {
        tpl: "test/modules/auth/jwt-auth.guard.test.ts.hbs",
        out: "test/modules/auth/jwt-auth.guard.test.ts",
      },
    ];

    for (const { tpl, out } of authTestFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Auth test template not found: ${tpl}`);
      }
    }

    // Rules engine tests
    try {
      const rulesEngineTestContent = await this.renderTemplate(
        "test/rules-engine.test.ts.hbs",
        context
      );
      await fs.writeFile(path.join(outputDir, "test/rules-engine.test.ts"), rulesEngineTestContent);
    } catch (_e) {
      console.warn("Rules engine test template not found");
    }

    // Trigger-workflow integration tests
    try {
      const triggerWorkflowTestContent = await this.renderTemplate(
        "test/rules-workflow-trigger.test.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "test/rules-workflow-trigger.test.ts"),
        triggerWorkflowTestContent
      );
    } catch (_e) {
      console.warn("Trigger-workflow test template not found");
    }

    // Job queue tests
    try {
      const jobQueueTestContent = await this.renderTemplate(
        "test/modules/jobs/job-queue.service.test.ts.hbs",
        context
      );
      await fs.writeFile(
        path.join(outputDir, "test/modules/jobs/job-queue.service.test.ts"),
        jobQueueTestContent
      );
    } catch (_e) {
      console.warn("Job queue test template not found");
    }

    // Executor and lifecycle tests. These templates existed but were never
    // rendered, so the suites that cover multi-step workflow ordering,
    // cross-entity targeting and the promotion pipeline never ran in a
    // generated app — the code they guard shipped untested.
    const behaviourTestFiles = [
      {
        tpl: "test/workflow-multi-entity.test.ts.hbs",
        out: "test/workflow-multi-entity.test.ts",
      },
      { tpl: "test/entity-promotion.test.ts.hbs", out: "test/entity-promotion.test.ts" },
    ];

    for (const { tpl, out } of behaviourTestFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Behaviour test template not found: ${tpl}`);
      }
    }

    // Trigger task tests
    const triggerTestFiles = [
      { tpl: "test/trigger/email.task.test.ts.hbs", out: "test/trigger/email.task.test.ts" },
      { tpl: "test/trigger/report.task.test.ts.hbs", out: "test/trigger/report.task.test.ts" },
      { tpl: "test/trigger/sync.task.test.ts.hbs", out: "test/trigger/sync.task.test.ts" },
    ];

    for (const { tpl, out } of triggerTestFiles) {
      try {
        const content = await this.renderTemplate(tpl, context);
        await fs.writeFile(path.join(outputDir, out), content);
      } catch (_e) {
        console.warn(`Trigger test template not found: ${tpl}`);
      }
    }
  }

  /**
   * Copy the client-logs module (static): where the browser reports its errors.
   */
  private async generateClientLogsModule(outputDir: string): Promise<void> {
    const templateDir = path.join(
      resolveTemplateDir("tanstack-start-nestjs/backend"),
      "src/modules/client-logs"
    );
    const outDir = path.join(outputDir, "src/modules/client-logs");
    await fs.mkdir(outDir, { recursive: true });
    for (const file of [
      "client-log-rules.ts",
      "client-logs.controller.ts",
      "client-logs.module.ts",
    ]) {
      await fs.copyFile(path.join(templateDir, file), path.join(outDir, file));
    }
  }

  /**
   * Copy the notifications module (static — no Handlebars variables).
   *
   * It reads `audit_log` and writes only read marks, so nothing in it depends
   * on the model. Copied rather than rendered for the same reason the audit
   * module is.
   */
  private async generateNotificationsModule(outputDir: string): Promise<void> {
    const templateDir = path.join(
      resolveTemplateDir("tanstack-start-nestjs/backend"),
      "src/modules/notifications"
    );
    const notificationsOutputDir = path.join(outputDir, "src/modules/notifications");
    await fs.mkdir(notificationsOutputDir, { recursive: true });

    const files = [
      "notifications.controller.ts",
      "notifications.module.ts",
      "notifications.service.ts",
      "notifications.types.ts",
    ];

    for (const file of files) {
      try {
        await fs.copyFile(path.join(templateDir, file), path.join(notificationsOutputDir, file));
      } catch (e) {
        console.warn(
          `Notifications module file not found, skipping: ${file} — ${(e as Error).message}`
        );
      }
    }
  }

  /**
   * Copy static audit module files from templates (no Handlebars variables).
   */
  private async generateAuditModule(outputDir: string): Promise<void> {
    const auditTemplateDir = path.join(
      resolveTemplateDir("tanstack-start-nestjs/backend"),
      "src/modules/audit"
    );
    const auditOutputDir = path.join(outputDir, "src/modules/audit");

    const auditFiles = [
      "audit.controller.ts",
      "audit.interceptor.ts",
      "audit.module.ts",
      "audit.service.ts",
      "audit.types.ts",
      "immudb.service.ts",
      // One record's history and its notes, scoped to that entity's own `read`
      // rather than to an admin role — see RecordHistoryController.
      "record-history.controller.ts",
      "record-history.service.ts",
    ];

    for (const file of auditFiles) {
      try {
        await fs.copyFile(path.join(auditTemplateDir, file), path.join(auditOutputDir, file));
      } catch (e) {
        console.warn(`Audit module file not found, skipping: ${file} — ${(e as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Single-entity generation (for generate:entity CLI command)
  // ---------------------------------------------------------------------------

  /**
   * Generate only the files that belong to a single entity:
   *   • src/modules/rules/jdm/<tableName>.jdm.json
   *   • src/migrations/<ts>_add_<snake>.ts  (additive migration)
   *
   * @param entity      The target entity (from the .mmd file)
   * @param relationships  All relationships in the model (filtered internally)
   * @param outputDir   Backend project root (e.g. <project>/backend)
   * @param allEntities All entities in the model (for full context, if needed)
   */
  /**
   * Generate only the files that belong to a single entity.
   *
   *   Always generated:
   *     • src/modules/rules/jdm/<tableName>.jdm.json
   *
   *   Generated unless opts.skipMigration = true:
   *     • src/migrations/<ts>_add_<snake>.ts  (additive migration)
   *
   * @param opts.skipMigration  Set true during full project generation (the bulk
   *                            migration handles schema creation); leave false
   *                            (default) when adding a single entity to an
   *                            existing project via `generate:entity`.
   */
  public async generateSingleEntity(
    entity: Entity,
    relationships: Relationship[],
    outputDir: string,
    _allEntities: Entity[],
    opts?: { skipMigration?: boolean }
  ): Promise<void> {
    const busEntity = entityToBusEntity(entity, declaredEntityNames(_allEntities));

    const toSnake = (name: string) =>
      name
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();

    // 1. JDM rule file (delegates to shared helper)
    await fs.mkdir(path.join(outputDir, "src/modules/rules/jdm"), { recursive: true });
    await this.writeEntityJdm(busEntity, outputDir);
    console.log(`  ✓ backend/src/modules/rules/jdm/${busEntity.tableName}.jdm.json`);

    // 2. Additive migration (only when adding an entity to an existing project)
    if (!opts?.skipMigration) {
      const entityRels = relationships
        .filter((r) => r.sourceEntity === entity.name || r.targetEntity === entity.name)
        .map((r) => ({
          ...r,
          sourceTableName: `bus_${toSnake(r.sourceEntity)}`,
          targetTableName: `bus_${toSnake(r.targetEntity)}`,
        }));

      const migrationsDir = path.join(outputDir, "src/migrations");
      await fs.mkdir(migrationsDir, { recursive: true });
      try {
        const timestamp = Date.now();
        const snake = toSnake(entity.name);
        const migrationContent = await this.renderTemplate(
          "../../common/migrations/bus-table.migration.ts.hbs",
          {
            ...busEntity,
            relationships: entityRels,
            timestamps: true,
            now: new Date().toISOString(),
          }
        );
        const migrationFile = `${timestamp}_add_${snake}.ts`;
        await fs.writeFile(path.join(migrationsDir, migrationFile), migrationContent);
        console.log(`  ✓ backend/src/migrations/${migrationFile}`);
      } catch (e) {
        console.warn(`  ⚠️  Migration template failed for ${entity.name}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * The model-context module: retrieval over the `.eml.mmd` this application
   * was generated from, so an administrator extending it has an assistant that
   * answers from the model rather than from guesswork.
   *
   * `rag.ts` is the generator's own chunker, copied verbatim — it is written
   * dependency-free precisely so the definition of what an EML document means
   * does not fork between the tool that writes models and the applications
   * that run them.
   */
  private async generateModelContextModule(
    outputDir: string,
    context: Record<string, unknown>
  ): Promise<void> {
    const moduleDir = path.join(outputDir, "src/modules/model-context");
    await fs.mkdir(moduleDir, { recursive: true });

    const files = [
      "model-context.service.ts",
      "model-context.controller.ts",
      "model-context.module.ts",
      "rag.ts",
    ];

    for (const file of files) {
      try {
        const content = await this.renderTemplate(`src/modules/model-context/${file}.hbs`, context);
        await fs.writeFile(path.join(moduleDir, file), content);
      } catch (error) {
        console.warn(`Model-context file not generated: ${file} — ${(error as Error).message}`);
      }
    }
  }

  /**
   * Copy static workflow-definitions module files from templates (no Handlebars variables).
   */
  private async generateWorkflowDefinitionsModule(outputDir: string): Promise<void> {
    const wdTemplateDir = path.join(
      resolveTemplateDir("tanstack-start-nestjs/backend"),
      "src/modules/workflow-definitions"
    );
    const wdOutputDir = path.join(outputDir, "src/modules/workflow-definitions");

    const wdFiles = [
      "workflow-definitions.controller.ts",
      "workflow-definitions.module.ts",
      "workflow-definitions.service.ts",
      "automation-compiler.ts",
      // The status flows an administrator redrew, loaded into common/lifecycle.ts,
      // and GET /api/lifecycles for the front end.
      "lifecycle-store.service.ts",
      "lifecycles.controller.ts",
    ];

    for (const file of wdFiles) {
      try {
        await fs.copyFile(path.join(wdTemplateDir, file), path.join(wdOutputDir, file));
      } catch (e) {
        console.warn(
          `Workflow-definitions file not found, skipping: ${file} — ${(e as Error).message}`
        );
      }
    }
  }
}
