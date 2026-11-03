/**
 * Bun E2E Test Generator
 *
 * Emits a self-contained `tests/` project alongside the generated backend and
 * frontend. Everything it writes runs on `bun:test` — the suites drive the
 * application through its HTTP API, which is the surface a Bun test runner can
 * actually reach (there is no browser here).
 *
 * Layout produced under <outputDir>/tests:
 *
 *   run.ts                       orchestrator — starts the app, runs suites in order
 *   harness/                     shared machinery (config, http, auth, factory, rules…)
 *   suites/00-health…08-users    one file per functional area
 *   suites/03-crud.<entity>      one per entity
 *   suites/05-rules.<entity>     one per entity
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type {
  BusEntity,
  BusEntityAttribute,
  Entity,
  EntityEnum,
  Relationship,
} from "@appwithai/core/types";
import { declaredEntityNames, entityToBusEntity } from "@appwithai/core/types";
import type { CompiledRbac } from "../../rbac";
import { deriveAccess } from "../../rbac/roles";
import type { CompiledReport } from "../../reports";
import { stateFieldOf } from "../../../../../language/state-field";
import type { CompiledRule } from "../../rules";
import type { CompiledWorkflow } from "../../workflows";
import { BaseGenerator } from "../base.generator";

function resolveTemplateDir(subpath: string): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "packages/generator/templates", subpath),
    path.join(cwd, "templates", subpath),
    path.join(cwd, "../../../packages/generator/templates", subpath),
    path.join(cwd, "../../packages/generator/templates", subpath),
    path.join(__dirname, "../../../templates", subpath),
    path.join(__dirname, "../../templates", subpath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export interface BunE2ETestGeneratorOptions {
  projectName: string;
  projectVersion: string;
  projectDescription: string;
  /** Backend port — the suites' default target. */
  port: number;
  /** Frontend port — sent as the Origin header. */
  frontendPort: number;
  /** Records the bulk-seed suite creates per entity. */
  recordsPerEntity?: number;
  /**
   * The `%%enum` declarations a `%%field` binds to a column. The dictionary
   * suite compares the options the API offers for a column against these, so
   * a dropdown that has drifted from the model is a failing test rather than a
   * screen nobody looked at.
   */
  modelEnums?: EntityEnum[];
  /**
   * The state machines `%%workflow … kind: state` declares. The transition
   * suite drives each one edge by edge, and asserts the edges the model never
   * drew are refused.
   */
  compiledWorkflows?: CompiledWorkflow[];
  /**
   * What `%%rbac` compiled to, and — through `deriveAccess` — the accounts the
   * application seeds for the roles it names.
   *
   * The access suite needs both halves. The rules say which roles an operation
   * admits; the accounts are how a test signs in as one of them. Deriving the
   * addresses in the suite instead would be a second implementation of a
   * naming convention, and the two would drift the first time it changed.
   */
  compiledRbac?: CompiledRbac;
  /**
   * The `%%report` directives the model declares, as `compileReports` returned
   * them.
   *
   * The reports suite needs the model's own list because `sys_report` is what
   * it is checking: a report the seed dropped, or one whose SQL names a column
   * a migration renamed, is served by nothing and reported by nothing. The
   * checker cannot catch either — it validates the directive's shape, never
   * that the query runs against the schema the generator emitted.
   */
  compiledReports?: CompiledReport[];
  /**
   * The compiled `%%rule` graphs. The factory invents numbers, and a model's own
   * `validation-error when: discount_percent > 40` refuses an update to a record
   * the factory gave 56 — so the suites read the ceilings off the rules and keep
   * the values they invent under them.
   */
  compiledRules?: CompiledRule[];
  /** The administrator address the bootstrap creates. */
  adminEmail?: string;
}

/** Static harness files copied verbatim (after Handlebars rendering). */
const HARNESS_FILES = [
  "config.ts",
  // The compiled %%rbac rules and the accounts the seeds gave those roles —
  // what the access suite drives, and what it compares the answers against.
  "access.ts",
  "http.ts",
  "auth.ts",
  "server.ts",
  "entities.ts",
  // What the model declared, as data: enum values and state-machine edges.
  // The dictionary and transition suites compare the running application
  // against this rather than against themselves.
  "model.ts",
  "factory.ts",
  "rules.ts",
  "workflows.ts",
  "manifest.ts",
  // What the run did and how long it took: the collector each suite process
  // appends to, and the merge the runner writes a report from.
  "metrics.ts",
  "report.ts",
  "harness.ts",
  "index.ts",
];

/** Suites that are generated once, not per entity. Order matters. */
const SHARED_SUITES = [
  "00-health.test.ts",
  "01-auth.test.ts",
  "02-dictionary.test.ts",
  // The window/tab/field layout every screen is drawn from, and the references
  // every lookup and dropdown is fed by. Split from 02 because a broken layout
  // and a broken reference fail for different reasons and want different names.
  "02b-dictionary-layout.test.ts",
  "02c-dictionary-references.test.ts",
  "04-bulk-seed.test.ts",
  "06-rules-workflow.test.ts",
  // The state machine, driven edge by edge — after the rule-triggered
  // workflows, because both write to the same status fields.
  "06b-workflow-transitions.test.ts",
  "06c-status-bound-workflow.test.ts",
  "07-workflow-random.test.ts",
  "08-users-roles.test.ts",
  "09-workflow-multistep.test.ts",
  // What the model *declared* about access, enums, naming and the API's
  // contract — each written against `harness/access.ts` and `harness/model.ts`
  // rather than against the dictionary the same generator wrote, so a rule the
  // seed dropped fails a test instead of agreeing with itself.
  "12-access-control.test.ts",
  "13-enum-integrity.test.ts",
  "14-validation.test.ts",
  "15-record-lifecycle.test.ts",
  "16-api-contract.test.ts",
  "17-display-identifier.test.ts",
  // The dictionary's own say over what a list shows and in what order. It
  // edits sys_window and puts it back, so it runs before the benchmarks read
  // the same lists.
  "19-window-list-defaults.test.ts",
  // The bell beside Log out: that a write produces both halves of its
  // transaction, that the list is the caller's own, newest first, and that a
  // read notification stays read. Runs after the lifecycle suites because it
  // asserts against the same promotion pipeline they exercise.
  "20-transaction-notifications.test.ts",
  // Every %%report the model declares: seeded into sys_report, offered by the
  // list, and actually runnable. Nothing else in this suite runs a line of the
  // model's own SQL, and the checker that validated the directive never saw
  // the schema the query has to match.
  "21-reports.test.ts",
  // Optimistic locking: a stale save is a 409 the form can offer "reload or
  // overwrite" on, and two saves racing from one version produce one winner.
  "22-optimistic-locking.test.ts",
  // What the rules & workflows screen saves: status machines as edges, processes as automations.
  "23-workflow-editors-api.test.ts",
  // Last, so they measure the fullest the tables will be this run.
  "10-benchmark.test.ts",
  "18-write-benchmark.test.ts",
  "11-performance-budget.test.ts",
];

/** Root-level files. */
const ROOT_FILES = ["package.json", "tsconfig.json", "README.md", "run.ts", "cleanup.ts"];

/** Files made executable after writing. */
const EXECUTABLE_FILES = ["run.ts", "cleanup.ts"];

export class BunE2ETestGenerator extends BaseGenerator {
  private readonly options: BunE2ETestGeneratorOptions;

  constructor(options: BunE2ETestGeneratorOptions) {
    super(resolveTemplateDir("tanstack-start-nestjs/tests"));
    this.options = options;
  }

  async generate(
    entities: Entity[],
    relationships: Relationship[],
    outputDir: string
  ): Promise<void> {
    const testsDir = path.join(outputDir, "tests");
    await fs.mkdir(path.join(testsDir, "harness"), { recursive: true });
    await fs.mkdir(path.join(testsDir, "suites"), { recursive: true });

    const declared = declaredEntityNames(entities);
    const busEntities = entities.map((entity) => entityToBusEntity(entity, declared));
    const context = this.buildContext(busEntities, relationships);

    await this.writeRootFiles(testsDir, context);
    await this.writeHarness(testsDir, context);
    await this.writeSharedSuites(testsDir, context);
    await this.writePerEntitySuites(testsDir, busEntities, context);

    const perEntity = busEntities.length * 2;
    console.log(
      `   ✓ tests/ — ${SHARED_SUITES.length + perEntity} suites, ` +
        `${HARNESS_FILES.length + 1} harness modules`
    );
  }

  /**
   * Hang `maxValue` on every numeric attribute a refusing rule caps.
   *
   * Reads the `prevent` rows of each compiled decision table and keeps the
   * simple `<field> > N` / `<field> >= N` conditions — the shape `%%action
   * validation-error when:` is written in for a bound. Anything else is left
   * alone: a condition the suite cannot read is one it has no ceiling for.
   */
  private withValueCeilings(entities: BusEntity[]): BusEntity[] {
    const ceilings = new Map<string, number>();
    for (const rule of this.options.compiledRules ?? []) {
      let graph: {
        nodes?: Array<{ type?: string; content?: { rules?: Array<Record<string, string>> } }>;
      };
      try {
        graph = JSON.parse(rule.jdmContent);
      } catch {
        continue;
      }
      for (const node of graph.nodes ?? []) {
        if (node.type !== "decisionTableNode") continue;
        for (const row of node.content?.rules ?? []) {
          if (row.o1 !== "'prevent'") continue;
          const match = /^\s*([A-Za-z_]\w*)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(row.i1 ?? "");
          if (!match) continue;
          const [, column, operator, bound] = match as unknown as [string, string, string, string];
          const ceiling = operator === ">=" ? Number(bound) - 0.01 : Number(bound);
          const key = `${rule.tableName}.${column}`;
          ceilings.set(key, Math.min(ceilings.get(key) ?? ceiling, ceiling));
        }
      }
    }
    if (ceilings.size === 0) return entities;

    return entities.map((entity) => ({
      ...entity,
      attributes: (entity.attributes ?? []).map((attribute) => {
        const column = (attribute as Partial<BusEntityAttribute>).columnName ?? attribute.name;
        const ceiling = ceilings.get(`${entity.tableName}.${column}`);
        return ceiling === undefined ? attribute : { ...attribute, maxValue: ceiling };
      }),
    })) as BusEntity[];
  }

  /**
   * Hang `uniqueTogether` on every entity that declares a unique index over more
   * than one column — `%%index BookingShipment(booking_id, shipment_id) unique`.
   *
   * A single-column unique index is already on the column (`unique`), and the
   * factory salts it. A pair is a property of the entity, and a suite that reuses
   * one parent for every record it creates writes the same pair twice and is
   * refused with a 409 that is the constraint working, not the application failing.
   */
  private withUniqueTogether(entities: BusEntity[]): BusEntity[] {
    return entities.map((entity) => ({
      ...entity,
      uniqueTogether: (entity.indexes ?? [])
        .filter((index) => index.unique && index.columns.length > 1)
        .map((index) => index.columns),
    })) as BusEntity[];
  }

  /**
   * Every condition under which a compiled rule refuses a write, as text.
   *
   * The factory redraws a record that would trip one (see `harness/factory.ts`),
   * so a CRUD run is not at the mercy of which status or amount it happened to
   * invent. Rows that are not a refusal, and rules whose JSON cannot be read,
   * contribute nothing.
   */
  private refusals(): Array<{ tableName: string; when: string }> {
    const found: Array<{ tableName: string; when: string }> = [];
    for (const rule of this.options.compiledRules ?? []) {
      let graph: {
        nodes?: Array<{ type?: string; content?: { rules?: Array<Record<string, string>> } }>;
      };
      try {
        graph = JSON.parse(rule.jdmContent);
      } catch {
        continue;
      }
      for (const node of graph.nodes ?? []) {
        if (node.type !== "decisionTableNode") continue;
        for (const row of node.content?.rules ?? []) {
          const when = (row.i1 ?? "").trim();
          if (row.o1 === "'prevent'" && when && when !== "true") {
            found.push({ tableName: rule.tableName, when });
          }
        }
      }
    }
    return found;
  }

  /**
   * Every column a compiled `transform` rule overwrites after a write.
   *
   * A suite that stores a distinctive value in such a column and reads it back
   * is asserting against the rule, not the API: `stampCashReference` rewrites
   * `reference` on every cash payment, so the text-search case never found its
   * needle. The harness keeps free-text probes off these columns.
   */
  private transforms(): Array<{ tableName: string; column: string }> {
    const found: Array<{ tableName: string; column: string }> = [];
    for (const rule of this.options.compiledRules ?? []) {
      let graph: {
        nodes?: Array<{ type?: string; content?: { rules?: Array<Record<string, string>> } }>;
      };
      try {
        graph = JSON.parse(rule.jdmContent);
      } catch {
        continue;
      }
      for (const node of graph.nodes ?? []) {
        if (node.type !== "decisionTableNode") continue;
        for (const row of node.content?.rules ?? []) {
          const column = (row.o5 ?? "").trim().replace(/^'(.*)'$/, "$1");
          if (row.o1 === "'transform'" && column) {
            found.push({ tableName: rule.tableName, column });
          }
        }
      }
    }
    return found;
  }

  // ── context ───────────────────────────────────────────────────────────────

  private buildContext(
    entities: BusEntity[],
    relationships: Relationship[]
  ): Record<string, unknown> {
    entities = this.withUniqueTogether(this.withValueCeilings(entities));
    return {
      project: {
        name: this.options.projectName,
        version: this.options.projectVersion,
        description: this.options.projectDescription,
        id: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      },
      config: {
        port: this.options.port,
        frontendPort: this.options.frontendPort,
        recordsPerEntity: this.options.recordsPerEntity ?? 1000,
        // A file-level budget: the per-entity suites make several round trips
        // per entity, so a 90-entity model needs more than a 19-entity one.
        suiteTimeoutMs: Math.max(180_000, entities.length * 6_000),
      },
      entities,
      relationships,
      fkOverrides: this.buildFkOverrides(entities, relationships),
      modelEnums: this.options.modelEnums ?? [],
      modelReports: (this.options.compiledReports ?? []).map((report) => ({
        name: report.name,
        title: report.title,
        entity: report.entity ?? "",
        chart: report.chart ?? "",
        x: report.x ?? "",
        y: report.y ?? "",
      })),
      refusals: this.refusals(),
      transforms: this.transforms(),
      stateMachines: this.stateMachines(entities),
      ...this.accessContext(entities),
      now: new Date().toISOString(),
    };
  }

  /**
   * `%%rbac` as the suites see it: the operation rules, and one seeded account
   * per role.
   *
   * Both come from the same `deriveAccess` the seeds use, so a suite that signs
   * in as `manager@…` is using the address the application actually created.
   * A model with no `%%rbac` directives yields empty arrays and the access
   * suite skips itself rather than inventing restrictions to check.
   */
  private accessContext(entities: BusEntity[]): Record<string, unknown> {
    const compiled = this.options.compiledRbac;
    if (!compiled || compiled.operations.length === 0) {
      return { rbacRules: [], roleAccounts: [] };
    }

    const projectId = this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const derived = deriveAccess(compiled, {
      projectId,
      entities: entities.map((entity) => (entity as any).originalName || entity.name),
      adminEmail: this.options.adminEmail,
    });

    const byName = new Map(
      entities.map((entity) => [
        String((entity as any).originalName || entity.name).toLowerCase(),
        entity,
      ])
    );

    const rbacRules = compiled.operations
      .map((rule) => {
        const entity = byName.get(rule.entity.toLowerCase());
        return {
          entity: rule.entity,
          tableName: rule.tableName,
          // The route a suite calls — `bus_class_session` is the table, but the
          // API is addressed by the entity's route segment.
          route: entity ? (entity as any).route || entity.tableName : rule.tableName,
          operation: rule.operation,
          roles: rule.roles,
        };
      })
      // An entity the model restricts but does not declare has no route to
      // drive; the guard still enforces it, but the suite cannot reach it.
      .filter((rule) => byName.has(rule.entity.toLowerCase()));

    const roleAccounts = derived.users.map((user) => ({
      email: user.email,
      name: user.name,
      roleName: user.roleName,
      declaredAs:
        derived.roles.find((role) => role.name === user.roleName)?.declaredAs ?? user.roleName,
      isAdmin: user.isAdmin === true,
    }));

    return { rbacRules, roleAccounts };
  }

  private buildFkOverrides(
    busEntities: BusEntity[],
    relationships: Relationship[]
  ): Array<{ column: string; table: string }> {
    const tableSet = new Set(busEntities.map((e) => e.tableName));
    const entityToTable = new Map(
      busEntities.map((e) => [((e as any).originalName || e.name).toLowerCase(), e.tableName])
    );

    const overrides: Array<{ column: string; table: string }> = [];
    const seen = new Set<string>();

    for (const entity of busEntities) {
      const entityName = ((entity as any).originalName || entity.name).toLowerCase();
      const fkAttrs = (entity.attributes || []).filter((a: any) => a.isForeignKey);
      const parentRels = relationships.filter((r) => r.targetEntity.toLowerCase() === entityName);

      for (const attr of fkAttrs) {
        const col = (attr as any).columnName || attr.name;
        if (seen.has(col)) continue;
        const base = col.replace(/_id$/, "");
        if (tableSet.has(`bus_${base}`)) continue;

        for (const rel of parentRels) {
          const srcTable = entityToTable.get(rel.sourceEntity.toLowerCase());
          if (!srcTable) continue;
          const srcBase = srcTable.replace(/^bus_/, "");
          if (base === srcBase) continue;
          const alreadyResolved = fkAttrs.some((a: any) => {
            const b = ((a as any).columnName || a.name).replace(/_id$/, "");
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
      const fkAttrs = (entity.attributes || []).filter((a: any) => a.isForeignKey);
      for (const attr of fkAttrs) {
        const col = (attr as any).columnName || attr.name;
        if (seen.has(col)) continue;
        if (personTable && (col.endsWith("_by_id") || col.endsWith("_by"))) {
          overrides.push({ column: col, table: personTable });
          seen.add(col);
        }
      }
    }

    return overrides;
  }

  /**
   * The model's state machines, resolved onto the physical tables the suites
   * drive: entity name, table, the status column the guard reads, and the
   * edges — the same derivation the backend's transition seed performs, so the
   * suite and the seed cannot disagree about what the model said.
   */
  private stateMachines(entities: BusEntity[]): Array<Record<string, unknown>> {
    const byEntity = new Map<string, CompiledWorkflow>();
    for (const workflow of this.options.compiledWorkflows ?? []) {
      if (!byEntity.has(workflow.entity)) byEntity.set(workflow.entity, workflow);
    }

    const machines: Array<Record<string, unknown>> = [];
    for (const entity of entities) {
      // `originalName` is the entity as the ERD spelled it, which is the key
      // `CompiledWorkflow.entity` carries; `name` is the same string for every
      // model that does not rename, and the fallback covers the ones that do.
      const workflow = byEntity.get(entity.name) ?? byEntity.get(entity.originalName);
      if (!workflow || workflow.transitions.length === 0) continue;

      // entityToBusEntity gives every attribute a physical `columnName`; the
      // inherited attribute type does not declare it, so it is read through the
      // bus-entity attribute shape rather than assumed.
      const columns = ((entity.attributes ?? []) as Array<Partial<BusEntityAttribute>>).map(
        (attribute) => attribute.columnName ?? attribute.name
      );
      const statusField =
        stateFieldOf(columns.filter((name): name is string => !!name)) ?? "workflow_status";

      // `[*]` is the diagram's start and end marker, not a state a record is
      // ever in — the seed drops those edges, so the suite must too or it
      // would assert against transitions the guard has never heard of.
      const edges = workflow.transitions
        .filter((t) => t.from !== "[*]" && t.to !== "[*]")
        .map((t) => ({ from: t.from, to: t.to, trigger: t.trigger ?? "" }));
      if (edges.length === 0) continue;

      machines.push({
        entity: entity.name,
        tableName: entity.tableName,
        statusField,
        initial: workflow.initial ?? "",
        // A state the diagram sends to `[*]` is not terminal if it also draws a way
        // out (`closed --> [*]` beside `closed --> available : reopen`): the suite
        // asserts a terminal state offers no move, so it is only handed the states
        // that really have none.
        terminal: (workflow.terminal ?? []).filter(
          (state) => !edges.some((edge) => edge.from === state)
        ),
        edges,
      });
    }
    return machines;
  }

  // ── writers ───────────────────────────────────────────────────────────────

  private async writeRootFiles(testsDir: string, context: Record<string, unknown>): Promise<void> {
    for (const file of ROOT_FILES) {
      const content = await this.renderTemplate(`${file}.hbs`, context);
      await fs.writeFile(path.join(testsDir, file), content);
    }

    for (const file of EXECUTABLE_FILES) {
      // chmod is best-effort — Windows and some CI filesystems reject it.
      await fs.chmod(path.join(testsDir, file), 0o755).catch(() => {});
    }
  }

  private async writeHarness(testsDir: string, context: Record<string, unknown>): Promise<void> {
    for (const file of HARNESS_FILES) {
      const content = await this.renderTemplate(`harness/${file}.hbs`, context);
      await fs.writeFile(path.join(testsDir, "harness", file), content);
    }

    // The test vocabulary — `describe`, `it`, `expect` — over `node:test`. No
    // model reaches it, so it is the same file in every generated application.
    await fs.writeFile(
      path.join(testsDir, "harness", "testing.ts"),
      await this.component("harness/testing.ts")
    );
  }

  private async writeSharedSuites(
    testsDir: string,
    context: Record<string, unknown>
  ): Promise<void> {
    for (const file of SHARED_SUITES) {
      const content = await this.renderTemplate(`suites/${file}.hbs`, context);
      await fs.writeFile(path.join(testsDir, "suites", file), content);
    }
  }

  /**
   * One CRUD file and one rules file per entity, so a failure names the entity
   * that broke instead of collapsing every entity into one suite.
   *
   * Filenames carry the group's numeric prefix (03 for CRUD, 05 for rules) so
   * the runner's filename sort keeps them in the intended position relative to
   * the shared suites.
   */
  private async writePerEntitySuites(
    testsDir: string,
    entities: BusEntity[],
    context: Record<string, unknown>
  ): Promise<void> {
    for (const entity of entities) {
      const slug = entity.tableName.replace(/^bus_/, "").replace(/[^a-z0-9]+/gi, "-");
      const entityContext = { ...context, entity };

      const crud = await this.renderTemplate("suites/crud-entity.test.ts.hbs", entityContext);
      await fs.writeFile(path.join(testsDir, "suites", `03-crud.${slug}.test.ts`), crud);

      const rules = await this.renderTemplate("suites/rules-entity.test.ts.hbs", entityContext);
      await fs.writeFile(path.join(testsDir, "suites", `05-rules.${slug}.test.ts`), rules);
    }
  }
}

export default BunE2ETestGenerator;
