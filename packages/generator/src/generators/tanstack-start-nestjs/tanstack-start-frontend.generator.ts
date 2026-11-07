/* eslint-disable @typescript-eslint/no-explicit-any -- template context objects are dynamically shaped */
/**
 * TanStack Start + Shadcn UI Frontend Generator
 *
 * Two-phase generation process:
 * 1. Scaffold using TanStack Start CLI (bun create tanstack-start)
 * 2. Overlay custom generator templates on top
 *
 * Generates a complete TanStack Start frontend with:
 * - File-based routing with Vite + Vinxi
 * - Shadcn UI components
 * - TanStack Query for data fetching
 * - TanStack Table for data grids
 * - TanStack Form for forms
 * - Runtime UI layout modification via sys_field.seq_no
 *
 * Generated from templates in tanstack-start-nestjs/frontend/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  declaredEntityNames,
  type Entity,
  entityToBusEntity,
  formatDisplayName,
  type Relationship,
} from "@appwithai/core/types";
import { kebabCase } from "@appwithai/core/utils";
import type { CompiledRbac } from "../../rbac";
import { deriveAccess } from "../../rbac/roles";
import type { CompiledReport } from "../../reports";
import { CliExecutor } from "../../utils/cli-executor";
import { BaseGenerator } from "../base.generator";
import { DEFAULT_FRONTEND_PORT } from "../ports";
import { ensureEditorsVendored } from "./vendor-editors";
import { renderLifecycleModule } from "./lifecycle-module";
import type { CompiledWorkflow } from "../../workflows";

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

export interface TanStackStartFrontendOptions {
  projectName: string;
  projectVersion: string;
  projectDescription: string;
  apiBaseUrl: string;
  /** Port the dev/preview server binds to. Defaults to DEFAULT_FRONTEND_PORT. */
  frontendPort?: number;
  enableDarkMode: boolean;
  stackOption?: "tanstackjs-nestjs" | "tanstack-start-nestjs";
  /**
   * Skip the network CLI scaffolding step (`bun create tanstack-start`) and
   * generate the project purely from the bundled templates. Useful for offline
   * / CI generation where the scaffolding CLI is unavailable.
   */
  skipCliScaffold?: boolean;
  /**
   * The model's compiled `%%rbac`, so `app-meta.ts` can list the seeded
   * accounts and what each role sees. The front end enforces nothing — the
   * guard does — but a sign-in screen that cannot name the roles leaves the
   * access control the model declared invisible in the running application.
   */
  compiledRbac?: CompiledRbac;
  /**
   * The model's compiled `%%report`. The screen fetches the list from the API
   * rather than from here; what this carries is whether there are any at all,
   * so an application generated from a model declaring none can say so instead
   * of rendering an empty list that reads like a broken request.
   */
  compiledReports?: CompiledReport[];
  /**
   * The model's state machines, for `src/lib/lifecycle.ts` — the same module the
   * backend reads (`renderLifecycleModule`), so the form draws a record's phase
   * and locks the end of its flow exactly where the API does.
   */
  compiledWorkflows?: CompiledWorkflow[];
}

export class TanStackStartFrontendGenerator extends BaseGenerator {
  private options: TanStackStartFrontendOptions;
  private resolvedTemplateDir: string;

  constructor(options: TanStackStartFrontendOptions) {
    // All frontend templates live in tanstack-start-nestjs/frontend/ as the
    // single canonical source. tanstackjs-nestjs/frontend/ is kept only for
    // legacy scaffold scaffolding differences; Electric/TanStack DB templates
    // are not duplicated there.
    const templateDir = resolveTemplateDir("tanstack-start-nestjs/frontend");
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
      console.log(`\n📦 Phase 1: Scaffolding TanStack Start project...`);
      await this.scaffoldTanStackProject(outputDir);
    }

    console.log(`\n🎨 Phase 2: Overlaying custom templates...`);
    // Prepare context for templates
    const context = this.prepareContext(entities, relationships);

    // Create additional directories beyond TanStack Start scaffolding
    await this.createAdditionalDirectories(outputDir);

    // Copy static assets served from the app's own origin (self-hosted fonts)
    await this.copyPublicAssets(outputDir);

    // Generate core application files
    await this.generateCoreFiles(outputDir, context);

    // Generate API client and hooks
    await this.generateApiLayer(outputDir, context);

    // Generate UI components
    await this.generateComponents(outputDir, context);

    // Generate entity pages
    await this.generateEntityPages(outputDir, context);

    // Generate admin pages for field layout
    await this.generateAdminPages(outputDir, context);

    // Update configuration files
    await this.updateConfigFiles(outputDir, context);

    // Generate test files
    await this.generateTestFiles(outputDir, context);

    console.log(`\n✅ TanStack Start frontend generation complete!`);
  }

  /**
   * Phase 1: Scaffold base TanStack Start project using CLI
   */
  private async scaffoldTanStackProject(outputDir: string): Promise<void> {
    const parentDir = path.dirname(outputDir);
    const projectName = path.basename(outputDir);

    // Create parent directory if it doesn't exist
    await fs.mkdir(parentDir, { recursive: true });

    // `bun create` has no --yes option, so the previous attempt at one failed on
    // every run and printed "unknown option '--yes'" before retrying. There is
    // only one correct invocation.
    try {
      console.log(`  Creating TanStack Start project: ${projectName}`);
      await CliExecutor.executeAsync("bun", ["create", "tanstack-start@latest", projectName], {
        cwd: parentDir,
        stdio: "inherit",
        timeout: 600000,
        // Accept defaults rather than blocking on prompts.
        env: { ...process.env, BUN_CREATE_NONINTERACTIVE: "1" },
      });
      console.log(`  ✅ TanStack Start scaffolding complete`);
    } catch (error) {
      // Not fatal, and not unusual: the scaffold needs the npm registry, and the
      // templates below write every file the generated app needs regardless.
      console.log(
        `  Skipping CLI scaffolding (${(error as Error).message.split("\n")[0]}) — generating from templates`
      );
    }
  }

  /**
   * Create additional directories beyond TanStack Start scaffolding
   */
  private async createAdditionalDirectories(outputDir: string): Promise<void> {
    const dirs = [
      "src/routes",
      "src/routes/admin",
      "src/routes/auth",
      "src/components/ui",
      "src/components/admin",
      "src/components/forms",
      "src/components/tables",
      "src/components/layout",
      "src/components/skeletons",
      "src/contexts",
      "src/hooks",
      "src/i18n",
      "src/lib",
      "src/messages",
      "src/providers",
      "src/styles",
      "src/types",
      "src/lib/queries",
      "src/lib/workflow",
      "src/lib/automation",
      "src/components/automation",
      "src/components/eml",
      "src/components/rules",
      "src/lib/eml",
      "src/components/reports",
      "src/components/notifications",
      "src/components/help",
      "src/components/theme",
      "test",
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(outputDir, dir), { recursive: true });
    }
  }

  private prepareContext(
    entities: Entity[],
    relationships: Relationship[]
  ): Record<string, unknown> {
    const declared = declaredEntityNames(entities);
    const busEntities = entities.map((entity) => entityToBusEntity(entity, declared));

    /*
     * No shortlist any more.
     *
     * The sidebar used to be handed `mainEntities` — ten entities chosen here,
     * each with an icon looked up in a hard-coded table-name map — and wrote
     * them into the component as a literal array. It now reads
     * `/sys/categories/dashboard` at runtime, the same statement the dashboard
     * reads, so the navigation is whatever the Application Dictionary says this
     * reader may open. The model's `%%entity <E> icon:` and any icon an
     * administrator set or uploaded both reach it; neither could before.
     */

    /* Same derivation the backend seed uses, so the addresses printed on the
       sign-in screen are the addresses the seed actually created. */
    const access = deriveAccess(this.options.compiledRbac ?? { operations: [], transitions: [] }, {
      projectId: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      entities: busEntities.map((entity) => entity.name),
    });

    return {
      access,
      project: {
        name: this.options.projectName,
        version: this.options.projectVersion,
        description: this.options.projectDescription,
        id: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        snake: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      },
      config: {
        baseUrl: this.options.apiBaseUrl,
        backendPort: (() => {
          try {
            return new URL(this.options.apiBaseUrl || "http://localhost:3001").port || "3001";
          } catch {
            return "3001";
          }
        })(),
        // package.json's dev/start scripts pass this to vinxi. Left undefined it
        // rendered as `vinxi dev --port ` and the server picked a port at random.
        frontendPort: this.options.frontendPort ?? DEFAULT_FRONTEND_PORT,
        enableDarkMode: this.options.enableDarkMode,
      },
      projectName: this.options.projectName,
      projectSnake: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      projectKebab: this.options.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      entities: busEntities,
      relationships,
      now: new Date().toISOString(),
    };
  }

  private async generateCoreFiles(outputDir: string, context: any): Promise<void> {
    const templateDir = this.resolvedTemplateDir;

    // The rule and workflow editors are one source shared with the modelling tool; a
    // generated application receives them as source under src/editors/.
    await ensureEditorsVendored(templateDir);
    await this.copyDirRecursive(
      path.join(templateDir, "src/editors"),
      path.join(outputDir, "src/editors")
    );

    // Entry files (client.tsx, ssr.tsx, router.tsx) - always generated to fix missing scaffolding
    const clientEntryContent = await this.renderTemplate("src/client.tsx.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/client.tsx"), clientEntryContent);

    const ssrEntryContent = await this.renderTemplate("src/ssr.tsx.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/ssr.tsx"), ssrEntryContent);

    const routerContent = await this.renderTemplate("src/router.tsx.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/router.tsx"), routerContent);

    // Root layout (__root.tsx)
    const layoutContent = await this.renderTemplate("src/routes/__root.tsx.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/routes/__root.tsx"), layoutContent);

    // Index page (redirects to dashboard)
    const homePageContent = await this.renderTemplate("src/routes/index.tsx.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/routes/index.tsx"), homePageContent);

    // Dashboard page (flat route file)
    const dashboardPageContent = await this.component("src/routes/dashboard.tsx");
    await fs.writeFile(path.join(outputDir, "src/routes/dashboard.tsx"), dashboardPageContent);

    // Admin layout route (guards /admin/* from non-admin users)
    try {
      const adminLayoutContent = await this.component("src/routes/admin.tsx");
      await fs.writeFile(path.join(outputDir, "src/routes/admin.tsx"), adminLayoutContent);
    } catch (_e) {
      console.warn("Admin layout route template not found");
    }

    // Providers index (rendered template)
    const providersContent = await this.component("src/providers/index.tsx");
    await fs.writeFile(path.join(outputDir, "src/providers/index.tsx"), providersContent);

    // ElectricProvider (static file — JSX double-braces conflict with Handlebars)
    try {
      await fs.copyFile(
        path.join(this.resolvedTemplateDir, "src/providers/electric-provider.tsx"),
        path.join(outputDir, "src/providers/electric-provider.tsx")
      );
    } catch (e) {
      console.warn("electric-provider static file not found, skipping:", (e as Error).message);
    }

    // Copy provider files (only query-provider; index.tsx comes from the .hbs template)
    const providerFiles = ["src/providers/query-provider.tsx"];

    for (const file of providerFiles) {
      try {
        await fs.copyFile(path.join(templateDir, file), path.join(outputDir, file));
      } catch (_e) {
        console.warn(`Provider file not found: ${file}`);
      }
    }

    // Copy contexts directory
    await fs.mkdir(path.join(outputDir, "src/contexts"), { recursive: true });
    try {
      await fs.copyFile(
        path.join(templateDir, "src/contexts/auth-context.tsx"),
        path.join(outputDir, "src/contexts/auth-context.tsx")
      );
    } catch (_e) {
      console.warn("Auth context file not found");
    }

    // Global styles
    const stylesContent = await this.component("src/styles/globals.css");
    await fs.writeFile(path.join(outputDir, "src/styles/globals.css"), stylesContent);

    // Auth pages. Login only — see below.
    try {
      const loginPageContent = await this.component("src/routes/auth/login.tsx");
      await fs.writeFile(path.join(outputDir, "src/routes/auth/login.tsx"), loginPageContent);
    } catch (_e) {
      console.warn("Login page template not found");
    }

    /* `/login` → `/auth/login`. A static route, so the router prefers it to the
       `$entity` catch-all that used to swallow the address and render an empty
       grid for an entity named "login". */
    try {
      const loginRedirect = await this.component("src/routes/login.tsx");
      await fs.writeFile(path.join(outputDir, "src/routes/login.tsx"), loginRedirect);
    } catch (_e) {
      console.warn("Login redirect template not found");
    }

    // No sign-up page. Accounts are created by an administrator from the user
    // management screen, and the backend refuses public sign-up outright — a
    // route that renders a form the server will reject is worse than no route.

    // Auth lib file (static)
    try {
      await fs.copyFile(
        path.join(templateDir, "src/lib/auth.ts"),
        path.join(outputDir, "src/lib/auth.ts")
      );
    } catch (_e) {
      console.warn("Auth lib file not found");
    }

    // The entry point that mounts the API router at all. Without this file
    // TanStack Start skips it, and every route under src/routes/api is served
    // by the page router as a missing page — see the file's own comment.
    try {
      const apiEntry = await this.renderTemplate("src/api.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "src/api.ts"), apiEntry);
    } catch (_e) {
      console.warn("API entry template not found");
    }

    // The forwarding both API routes are built on.
    try {
      const apiProxy = await this.component("src/lib/api-proxy.ts");
      await fs.writeFile(path.join(outputDir, "src/lib/api-proxy.ts"), apiProxy);
    } catch (_e) {
      console.warn("API proxy lib template not found");
    }

    // The assistant's runtime, served by the front end rather than proxied:
    // CopilotKit streams over its own protocol, and routing that through the
    // backend's request pipeline breaks streaming for no gain.
    try {
      const copilotRuntime = await this.component("src/lib/copilot-runtime.ts");
      await fs.writeFile(path.join(outputDir, "src/lib/copilot-runtime.ts"), copilotRuntime);
    } catch (_e) {
      console.warn("CopilotKit runtime lib template not found");
    }

    // The API, on the front end's own origin. Everything under /api/* is
    // forwarded to NestJS from inside the server, so the browser never learns
    // the API's port and the session cookie is a plain same-origin cookie. It
    // also answers /api/copilotkit itself — the client posts to that exact
    // address, which the splat route below can never match.
    try {
      await fs.mkdir(path.join(outputDir, "src/routes/api"), { recursive: true });
      const apiProxyContent = await this.renderTemplate("src/routes/api/$.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "src/routes/api/$.ts"), apiProxyContent);
    } catch (_e) {
      console.warn("API proxy route template not found");
    }

    // Auth proxy API route — catches /api/auth/* and proxies to NestJS backend
    try {
      await fs.mkdir(path.join(outputDir, "src/routes/api/auth"), { recursive: true });
      const authProxyContent = await this.renderTemplate("src/routes/api/auth/$.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "src/routes/api/auth/$.ts"), authProxyContent);
    } catch (_e) {
      console.warn("Auth proxy route template not found");
    }

    // The assistant's sub-paths. The address the client actually uses is
    // handled by the /api/$ route above; this covers anything below it.
    try {
      await fs.mkdir(path.join(outputDir, "src/routes/api/copilotkit"), { recursive: true });
      const copilotRuntime = await this.renderTemplate(
        "src/routes/api/copilotkit/$.ts.hbs",
        context
      );
      await fs.writeFile(path.join(outputDir, "src/routes/api/copilotkit/$.ts"), copilotRuntime);
    } catch (_e) {
      console.warn("CopilotKit runtime route template not found");
    }
  }

  private async generateApiLayer(outputDir: string, context: any): Promise<void> {
    const templateDir = this.resolvedTemplateDir;

    // The one module a model changes. Everything else in this front end is the
    // same code for every application and imports its identity from here.
    const appMeta = await this.renderTemplate("src/lib/app-meta.ts.hbs", context);
    await fs.writeFile(path.join(outputDir, "src/lib/app-meta.ts"), appMeta);

    const apiClientContent = await this.component("src/lib/api-client.ts");
    await fs.writeFile(path.join(outputDir, "src/lib/api-client.ts"), apiClientContent);

    // CSV export — every list grid offers its rows as a download.
    const csvContent = await this.component("src/lib/csv.ts");
    await fs.writeFile(path.join(outputDir, "src/lib/csv.ts"), csvContent);

    // How the browser logs, and how it reads what the API says went wrong. The API
    // client, the query provider and the root error component all import them, so
    // leaving them out fails the generated build.
    for (const file of ["logger.ts", "api-error.ts"]) {
      const content = await this.component(`src/lib/${file}`);
      await fs.writeFile(path.join(outputDir, "src/lib", file), content);
    }

    // A window label's plural, for list titles and breadcrumbs. The list and record
    // shells both import it, so leaving it out fails the generated build.
    const pluralLabelContent = await this.component("src/lib/plural-label.ts");
    await fs.writeFile(path.join(outputDir, "src/lib/plural-label.ts"), pluralLabelContent);

    // Optimistic locking: the If-Match header, recognising a stale save, and
    // which fields the other save changed. The record window and the update
    // hook both import it, so leaving it out fails the generated build.
    const versionConflictContent = await this.component("src/lib/version-conflict.ts");
    await fs.writeFile(path.join(outputDir, "src/lib/version-conflict.ts"), versionConflictContent);

    // Vite's asset-import suffixes (`?url`, `?raw`), which the compiler cannot
    // resolve on its own — without these the root route fails to typecheck on a
    // freshly generated app over an import that is perfectly correct.
    try {
      const viteEnv = await this.renderTemplate("src/vite-env.d.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "src/vite-env.d.ts"), viteEnv);
    } catch {
      // Non-fatal: the app runs either way.
    }

    // Field schema with Zod validation and field type helpers
    try {
      const fieldSchemaContent = await this.component("src/lib/field-schema.ts");
      await fs.writeFile(path.join(outputDir, "src/lib/field-schema.ts"), fieldSchemaContent);
    } catch (e) {
      console.warn("field-schema template not found, skipping:", (e as Error).message);
    }

    // Field logic — Compiere's Display, Read Only and Mandatory Logic. A copy of
    // language/field-logic.ts (templates/common/field-logic.ts, held identical
    // by a test), so the form reads a condition exactly as the API and the
    // checker do.
    const fieldLogic = await this.component("../../common/field-logic.ts");
    await fs.writeFile(path.join(outputDir, "src/lib/field-logic.ts"), fieldLogic);
    // Default Value and Obscure Type, read the same way the API reads them.
    const fieldValues = await this.component("../../common/field-values.ts");
    await fs.writeFile(path.join(outputDir, "src/lib/field-values.ts"), fieldValues);
    // Every table's lifecycle — Draft, the flow, Final — written by the same call
    // that writes the backend's, so the screen and the API agree about a record.
    await fs.writeFile(
      path.join(outputDir, "src/lib/lifecycle.ts"),
      renderLifecycleModule(context.entities ?? [], this.options.compiledWorkflows ?? [])
    );

    // TanStack DB collections, synced by ElectricSQL through the role-scoped
    // shape proxy. The dictionary lives in these collections; nothing else on
    // the client holds it.
    try {
      const collectionsContent = await this.component("src/lib/sys-collections.ts");
      await fs.writeFile(path.join(outputDir, "src/lib/sys-collections.ts"), collectionsContent);
    } catch (e) {
      console.warn("sys-collections template not found, skipping:", (e as Error).message);
    }

    // i18n translation utilities (static files, copy directly)
    const i18nFiles = [
      "src/lib/translations.tsx",
      "src/lib/i18n-fields.ts",
      "src/i18n/config.ts",
      "src/messages/en.json",
      "src/messages/de.json",
    ];

    for (const file of i18nFiles) {
      try {
        await fs.copyFile(path.join(templateDir, file), path.join(outputDir, file));
      } catch (_e) {
        console.warn(`i18n file not found: ${file}`);
      }
    }

    // Entity hooks using TanStack Query
    const hooksContent = await this.component("src/hooks/use-entities.ts");
    await fs.writeFile(path.join(outputDir, "src/hooks/use-entities.ts"), hooksContent);

    // Field metadata hooks (HTTP-based, kept for backwards compat)
    const fieldHooksContent = await this.component("src/hooks/use-field-metadata.ts");
    await fs.writeFile(path.join(outputDir, "src/hooks/use-field-metadata.ts"), fieldHooksContent);

    // The admin assistant's link to the model: a CopilotKit action that
    // searches what this application declares.
    try {
      const modelAssistant = await this.component("src/hooks/useModelAssistant.ts");
      await fs.writeFile(path.join(outputDir, "src/hooks/useModelAssistant.ts"), modelAssistant);
    } catch (_e) {
      console.warn("Model assistant hook template not found");
    }

    // Local-first sys_ hooks via TanStack DB + ElectricSQL
    try {
      const sysElectricContent = await this.component("src/hooks/use-sys-electric.ts");
      await fs.writeFile(path.join(outputDir, "src/hooks/use-sys-electric.ts"), sysElectricContent);
    } catch (e) {
      console.warn("use-sys-electric template not found, skipping:", (e as Error).message);
    }
  }

  private async generateComponents(outputDir: string, _context: any): Promise<void> {
    const templateDir = this.resolvedTemplateDir;

    // Copy Shadcn UI components (static files, no templating needed)
    const uiComponents = [
      "button",
      "input",
      "textarea",
      "checkbox",
      "select",
      "label",
      "skeleton",
      "table",
      "card",
      "tabs",
      "switch",
      "badge",
      "dropdown-menu",
      "avatar",
      "scroll-area",
      "alert-dialog",
      "dialog",
      "icon",
      "slider",
    ];

    for (const component of uiComponents) {
      try {
        await fs.copyFile(
          path.join(templateDir, `src/components/ui/${component}.tsx`),
          path.join(outputDir, `src/components/ui/${component}.tsx`)
        );
      } catch (_e) {
        console.warn(`UI component not found: ${component}`);
      }
    }

    // Copy utils for cn function
    try {
      await fs.copyFile(
        path.join(templateDir, "src/lib/utils.ts"),
        path.join(outputDir, "src/lib/utils.ts")
      );
    } catch (_e) {
      console.warn("Utils file not found");
    }

    // Copy layout components
    await fs.mkdir(path.join(outputDir, "src/components/layout"), { recursive: true });

    // Copy static layout components
    const staticLayoutComponents = [
      "src/components/layout/app-layout.tsx",
      "src/components/layout/header.tsx",
      "src/components/layout/index.ts",
    ];

    for (const component of staticLayoutComponents) {
      try {
        await fs.copyFile(path.join(templateDir, component), path.join(outputDir, component));
      } catch (_e) {
        console.warn(`Layout component not found: ${component}`);
      }
    }

    // Generate sidebar from template
    try {
      const sidebarContent = await this.renderTemplate(
        "src/components/layout/sidebar.tsx.hbs",
        _context
      );
      await fs.writeFile(path.join(outputDir, "src/components/layout/sidebar.tsx"), sidebarContent);
    } catch (e) {
      console.warn("Sidebar template generation failed:", (e as Error).message);
      // Fallback to copying static file if template doesn't exist
      try {
        await fs.copyFile(
          path.join(templateDir, "src/components/layout/sidebar.tsx"),
          path.join(outputDir, "src/components/layout/sidebar.tsx")
        );
      } catch (e2) {
        console.warn("Sidebar fallback also failed:", (e2 as Error).message);
      }
    }

    // Copy static React components (these have complex JSX that doesn't work well with Handlebars)
    const staticComponents = [
      {
        src: "src/components/forms/dynamic-form.tsx",
        dest: "src/components/forms/dynamic-form.tsx",
      },
      {
        src: "src/components/forms/master-detail-tabs.tsx",
        dest: "src/components/forms/master-detail-tabs.tsx",
      },
      {
        src: "src/components/tables/dynamic-table.tsx",
        dest: "src/components/tables/dynamic-table.tsx",
      },
      {
        src: "src/components/admin/field-layout-editor.tsx",
        dest: "src/components/admin/field-layout-editor.tsx",
      },
      {
        src: "src/components/admin/field-group-manager.tsx",
        dest: "src/components/admin/field-group-manager.tsx",
      },
      // AD (Application Dictionary) components
      {
        src: "src/components/admin/ad-window-shell.tsx",
        dest: "src/components/admin/ad-window-shell.tsx",
      },
      {
        src: "src/components/admin/ad-toolbar.tsx",
        dest: "src/components/admin/ad-toolbar.tsx",
      },
      {
        src: "src/components/admin/ad-breadcrumb.tsx",
        dest: "src/components/admin/ad-breadcrumb.tsx",
      },
      {
        src: "src/components/admin/ad-record-nav.tsx",
        dest: "src/components/admin/ad-record-nav.tsx",
      },
      {
        src: "src/components/admin/ad-sidebar.tsx",
        dest: "src/components/admin/ad-sidebar.tsx",
      },
      {
        src: "src/components/admin/ad-field-definitions.ts",
        dest: "src/components/admin/ad-field-definitions.ts",
      },
      {
        src: "src/components/admin/ad-window-configs.ts",
        dest: "src/components/admin/ad-window-configs.ts",
      },
      // Hooks
      {
        src: "src/hooks/use-record-navigation.ts",
        dest: "src/hooks/use-record-navigation.ts",
      },
      {
        src: "src/hooks/use-window-tabs.ts",
        dest: "src/hooks/use-window-tabs.ts",
      },
      {
        src: "src/hooks/use-bus-entity-level.ts",
        dest: "src/hooks/use-bus-entity-level.ts",
      },
      {
        src: "src/hooks/use-rule-entities.ts",
        dest: "src/hooks/use-rule-entities.ts",
      },
      {
        src: "src/hooks/use-dictionary-windows.ts",
        dest: "src/hooks/use-dictionary-windows.ts",
      },
      // UI components
      {
        src: "src/components/ui/breadcrumb.tsx",
        dest: "src/components/ui/breadcrumb.tsx",
      },
      {
        src: "src/components/ui/separator.tsx",
        dest: "src/components/ui/separator.tsx",
      },
      {
        src: "src/components/ui/tooltip.tsx",
        dest: "src/components/ui/tooltip.tsx",
      },
      // Skeletons
      {
        src: "src/components/skeletons/form-skeleton.tsx",
        dest: "src/components/skeletons/form-skeleton.tsx",
      },
      // Business entity level hook
      {
        src: "src/hooks/use-bus-entity-level.ts",
        dest: "src/hooks/use-bus-entity-level.ts",
      },
      // AD shell components
      {
        // The one help surface in a generated application: a toaster pinned to
        // the top right, opened by a `?` and closed by its own close button.
        // Every other piece of help — a window's, a field's, the automation
        // builder's — routes through it, so this file and the provider in
        // `providers/index.tsx` are the whole of it.
        src: "src/components/help/help-toaster.tsx",
        dest: "src/components/help/help-toaster.tsx",
      },
      {
        // Light / dark / system, applied to <html> before first paint.
        // `__root.tsx` imports THEME_BOOT_SCRIPT from here, so omitting it
        // fails the generated build rather than quietly shipping an
        // application stuck in one theme.
        src: "src/components/theme/theme-provider.tsx",
        dest: "src/components/theme/theme-provider.tsx",
      },
      {
        src: "src/components/theme/theme-toggle.tsx",
        dest: "src/components/theme/theme-toggle.tsx",
      },
      {
        // Shared by every shell — the `?` that puts a window's help in the
        // toaster. Was `window-help-dialog.tsx`, a centred modal that covered
        // the record it described.
        src: "src/components/admin/window-help-button.tsx",
        dest: "src/components/admin/window-help-button.tsx",
      },
      {
        src: "src/components/admin/ad-detail-shell.tsx",
        dest: "src/components/admin/ad-detail-shell.tsx",
      },
      {
        // The record's lifecycle — Draft, its status, Final, Error — read-only
        // in the detail header, and its action buttons beside it. ad-detail-shell
        // imports both, so leaving either out of this list fails the build.
        src: "src/components/admin/lifecycle-badge.tsx",
        dest: "src/components/admin/lifecycle-badge.tsx",
      },
      {
        src: "src/components/admin/record-actions.tsx",
        dest: "src/components/admin/record-actions.tsx",
      },
      {
        // Edit and two-step Delete on the User and Role screens. Both import
        // it, so leaving it out of this list fails the generated app's build.
        src: "src/components/admin/row-actions.tsx",
        dest: "src/components/admin/row-actions.tsx",
      },
      {
        // The entity icon control on the Table and Column detail screen: a
        // lucide name or an uploaded image, written to sys_table.icon.
        // admin/table/$tableId/index.tsx imports it, so leaving it out of this
        // list fails the generated app's build rather than losing it quietly.
        src: "src/components/admin/entity-icon-field.tsx",
        dest: "src/components/admin/entity-icon-field.tsx",
      },
      {
        // The model assistant, and with it the whole CopilotKit tree. Reached
        // only through `React.lazy` from src/routes/admin.tsx — which is the
        // point of it being a separate file, so keep it out of any static
        // import or the admin pages carry mermaid and shiki again.
        src: "src/components/admin/model-assistant.tsx",
        dest: "src/components/admin/model-assistant.tsx",
      },
      {
        // ad-detail-shell imports this, so leaving it out of the list does not
        // lose a feature quietly — it fails the generated app's build.
        src: "src/components/reports/ReportPrintModal.tsx",
        dest: "src/components/reports/ReportPrintModal.tsx",
      },
      {
        src: "src/components/reports/ReportDesigner.tsx",
        dest: "src/components/reports/ReportDesigner.tsx",
      },
      {
        // The bell beside Log out. Both the dashboard header and the shared
        // layout header import it, so omitting it fails the generated build
        // rather than quietly shipping an application with no notifications.
        src: "src/components/notifications/notification-bell.tsx",
        dest: "src/components/notifications/notification-bell.tsx",
      },
      {
        src: "src/components/admin/ad-list-shell.tsx",
        dest: "src/components/admin/ad-list-shell.tsx",
      },
      {
        src: "src/components/admin/entity-window-shell.tsx",
        dest: "src/components/admin/entity-window-shell.tsx",
      },
      {
        // The reload-or-overwrite choice the record window offers when
        // someone else saved the record first.
        src: "src/components/admin/version-conflict-dialog.tsx",
        dest: "src/components/admin/version-conflict-dialog.tsx",
      },
      {
        src: "src/components/admin/unified-field-layout.tsx",
        dest: "src/components/admin/unified-field-layout.tsx",
      },
      // Dynamic bus entity pages (for runtime-created entities)
      {
        src: "src/components/admin/bus-entity-page.tsx",
        dest: "src/components/admin/bus-entity-page.tsx",
      },
      {
        src: "src/components/admin/bus-entity-detail-page.tsx",
        dest: "src/components/admin/bus-entity-detail-page.tsx",
      },
      // The workflow editor, shared verbatim with the modelling tool so a
      // workflow drawn in either behaves the same way.
      // The date-picker fix the rule editor's Date operators need (GoRulesEditorPanel imports it).
      // The `?worker` imports Monaco's editor and language workers are loaded through.
      {
        src: "src/worker-modules.d.ts",
        dest: "src/worker-modules.d.ts",
      },
      // The generated application's own wrappers around those editors.
      {
        src: "src/components/rules/RuleGraphEditor.tsx",
        dest: "src/components/rules/RuleGraphEditor.tsx",
      },
      // Where this application reads and writes the rules and workflows the screen edits.
      {
        src: "src/lib/logic-host.ts",
        dest: "src/lib/logic-host.ts",
      },
      // The status flows as the API runs them, laid over the compiled lib/lifecycle.ts.
      {
        src: "src/lib/use-lifecycles.ts",
        dest: "src/lib/use-lifecycles.ts",
      },
      // Missing provider files
      {
        src: "src/providers/browser-router-provider.tsx",
        dest: "src/providers/browser-router-provider.tsx",
      },
      // Auth query hooks
      {
        src: "src/lib/queries/use-auth.ts",
        dest: "src/lib/queries/use-auth.ts",
      },
      // Extra UI components
      {
        src: "src/components/ui/empty-state.tsx",
        dest: "src/components/ui/empty-state.tsx",
      },
      {
        src: "src/components/ui/mobile-sidebar.tsx",
        dest: "src/components/ui/mobile-sidebar.tsx",
      },
      // Skeleton components
      {
        src: "src/components/skeletons/dashboard-skeleton.tsx",
        dest: "src/components/skeletons/dashboard-skeleton.tsx",
      },
      {
        src: "src/components/skeletons/table-rows-skeleton.tsx",
        dest: "src/components/skeletons/table-rows-skeleton.tsx",
      },
      {
        src: "src/components/skeletons/stats-card-skeleton.tsx",
        dest: "src/components/skeletons/stats-card-skeleton.tsx",
      },
    ];

    for (const component of staticComponents) {
      try {
        await fs.copyFile(
          path.join(templateDir, component.src),
          path.join(outputDir, component.dest)
        );
      } catch (_e) {
        console.warn(`Static component not found: ${component.src}`);
      }
    }

    // Copy dynamic catch-all routes for runtime-created entities
    const dynamicRoutes = ["$entity.tsx", "$entity.$id.tsx"];
    for (const routeFile of dynamicRoutes) {
      try {
        await fs.copyFile(
          path.join(templateDir, "src/routes", routeFile),
          path.join(outputDir, "src/routes", routeFile)
        );
      } catch (_e) {
        console.warn(`Dynamic route not found: ${routeFile}`);
      }
    }

    // routeTree.gen.ts is never *copied* from a template — a shipped copy named
    // a different sample app's entities (account/contact/activity/opportunity)
    // in every generated project, and stayed wrong until the first dev run.
    //
    // It is *generated* instead, from this project's own route files, once the
    // dependencies are installed (see the CLI's route-tree step). Leaving it to
    // the first `dev` meant a freshly generated application could not typecheck:
    // every route file referenced a module that did not exist yet, which reads
    // like 70-odd bugs and is none.
    //
    // `tsr.config.json` is what the router CLI reads; app.config.ts carries the
    // same settings for the Vite plugin.
    try {
      const tsrConfig = await this.renderTemplate("tsr.config.json.hbs", _context);
      await fs.writeFile(path.join(outputDir, "tsr.config.json"), tsrConfig);
    } catch (error) {
      // The Vite plugin still writes the tree on the first dev run, so this is
      // not fatal — but it is reported rather than swallowed. A silent catch
      // here hid a ReferenceError for a whole generation cycle.
      console.warn(`tsr.config.json not written: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Single-entity generation (reused by full generator + generate:entity CLI)
  // ---------------------------------------------------------------------------

  /**
   * Generate only the route files that belong to a single entity:
   *   • src/routes/<entity-kebab>.tsx          (list page)
   *   • src/routes/<entity-kebab>.$id.tsx      (detail page)
   *
   * @param busEntity   The busEntity entry (already inside context.entities)
   * @param context     Full project context (needed for sidebar, project config, etc.)
   * @param outputDir   Frontend project root
   */
  public async generateSingleEntityRoutes(
    busEntity: any,
    context: any,
    outputDir: string
  ): Promise<void> {
    // The fallback is core's too: this one lowered the rest of the name, so an
    // entity that ever reached it came out `Kycrecord`.
    const displayName = busEntity.displayName || formatDisplayName(busEntity.name);
    const entityContext = { ...context, entity: { ...busEntity, displayName } };
    await fs.mkdir(path.join(outputDir, "src/routes"), { recursive: true });

    const listPageFilename = `${kebabCase(busEntity.name)}.tsx`;
    const listPageContent = await this.renderTemplate(
      "src/routes/$entity/index.tsx.hbs",
      entityContext
    );
    await fs.writeFile(path.join(outputDir, "src/routes", listPageFilename), listPageContent);

    const detailPageFilename = `${kebabCase(busEntity.name)}.$id.tsx`;
    const detailPageContent = await this.renderTemplate(
      "src/routes/$entity/$id.tsx.hbs",
      entityContext
    );
    await fs.writeFile(path.join(outputDir, "src/routes", detailPageFilename), detailPageContent);
  }

  /**
   * Public entry-point for the generate:entity CLI command.
   * Builds the full project context (needed for sidebar/nav) then generates
   * the two route files for the named entity.
   */
  public async generateSingleEntity(
    entity: Entity,
    relationships: Relationship[],
    outputDir: string,
    allEntities: Entity[]
  ): Promise<void> {
    const context = this.prepareContext(allEntities, relationships);
    const busEntities = context.entities as any[];
    const busEntity =
      busEntities.find((e) => e.originalName === entity.name || e.name === entity.name) ??
      busEntities[0];

    await this.generateSingleEntityRoutes(busEntity, context, outputDir);

    const listFile = `${kebabCase(entity.name)}.tsx`;
    const detailFile = `${kebabCase(entity.name)}.$id.tsx`;
    console.log(`  ✓ frontend/src/routes/${listFile}`);
    console.log(`  ✓ frontend/src/routes/${detailFile}`);
  }

  private async generateEntityPages(outputDir: string, context: any): Promise<void> {
    for (const busEntity of context.entities) {
      await this.generateSingleEntityRoutes(busEntity, context, outputDir);
    }
  }

  private async generateAdminPages(outputDir: string, context: any): Promise<void> {
    const adminDir = path.join(outputDir, "src/routes/admin");
    await fs.mkdir(adminDir, { recursive: true });
    const templateDir = this.resolvedTemplateDir;

    // Static AD pages (ADWindowShell-based, no Handlebars needed)
    const staticAdminPages = [
      "index.tsx",
      "tables.tsx",
      "windows.tsx",
      "references.tsx",
      "elements.tsx",
    ];

    for (const page of staticAdminPages) {
      try {
        await fs.copyFile(
          path.join(templateDir, "src/routes/admin", page),
          path.join(adminDir, page)
        );
      } catch (_e) {
        console.warn(`Static admin page not found: ${page}`);
      }
    }

    // Field layout management - renders as /admin/fields via admin/fields.tsx
    const fieldsContent = await this.component("src/routes/admin/fields.tsx");
    await fs.writeFile(path.join(adminDir, "fields.tsx"), fieldsContent);

    // Business rules management - renders as /admin/rules via admin/rules.tsx
    try {
      const rulesContent = await this.renderTemplate("src/routes/admin/rules.tsx.hbs", context);
      await fs.writeFile(path.join(adminDir, "rules.tsx"), rulesContent);
    } catch (_e) {
      console.warn("Admin rules page template not found");
    }

    // Entity categories - the grouping the dashboard renders by
    try {
      const categoriesContent = await this.component("src/routes/admin/categories.tsx");
      await fs.writeFile(path.join(adminDir, "categories.tsx"), categoriesContent);
    } catch (_e) {
      console.warn("Admin categories page template not found");
    }

    // The automation builder - renders as /admin/automations. This is where
    // multi-step workflows and business rules are authored; admin/workflows.tsx
    // below stays as the monitoring view for runs that have already happened.
    try {
      const automationsContent = await this.renderTemplate(
        "src/routes/admin/automations.tsx.hbs",
        context
      );
      await fs.writeFile(path.join(adminDir, "automations.tsx"), automationsContent);
    } catch (_e) {
      console.warn("Admin automations page template not found");
    }

    // Workflow monitoring - renders as /admin/workflows via admin/workflows.tsx
    try {
      const workflowsContent = await this.component("src/routes/admin/workflows.tsx");
      await fs.writeFile(path.join(adminDir, "workflows.tsx"), workflowsContent);
    } catch (_e) {
      console.warn("Admin workflows page template not found");
    }

    // Copy audit page
    try {
      await fs.copyFile(
        path.join(templateDir, "src/routes/admin/audit.tsx"),
        path.join(adminDir, "audit.tsx")
      );
    } catch (_e) {
      console.warn("Admin audit page not found");
    }

    // The report-designs index — the list `/admin/reports` serves, and the only
    // way into the per-entity designer beneath it. Both the admin landing page
    // and the designer itself link to it, so leaving it out did not merely hide
    // a screen: it made those two links point at a route that does not exist,
    // which is a type error in the generated frontend and a dead link in it.
    try {
      const reportsContent = await this.component("src/routes/admin/reports.tsx");
      await fs.writeFile(path.join(adminDir, "reports.tsx"), reportsContent);
    } catch (_e) {
      console.warn("Admin reports page template not found");
    }

    // Analysis — the model's own `%%report` questions. Written whether or not
    // the model declared any: the admin landing page links to it from a static
    // list, so omitting the route on an empty model is a type error in the
    // generated frontend rather than one fewer screen. With no reports it says
    // the model declares none.
    try {
      const analysisContent = await this.component("src/routes/admin/analysis.tsx");
      await fs.writeFile(path.join(adminDir, "analysis.tsx"), analysisContent);
    } catch (_e) {
      console.warn("Admin analysis page template not found");
    }

    // Users page (admin/users.tsx)
    try {
      const usersContent = await this.component("src/routes/admin/users.tsx");
      await fs.writeFile(path.join(adminDir, "users.tsx"), usersContent);
    } catch (_e) {
      console.warn("Admin users page template not found");
    }

    // Roles page (admin/roles.tsx)
    try {
      const rolesContent = await this.component("src/routes/admin/roles.tsx");
      await fs.writeFile(path.join(adminDir, "roles.tsx"), rolesContent);
    } catch (_e) {
      console.warn("Admin roles page template not found");
    }

    // System configuration page (admin/system-config.tsx). The admin index links
    // to it; without this copy the card pointed at a route that did not exist.
    try {
      const systemConfigContent = await this.component("src/routes/admin/system-config.tsx");
      await fs.writeFile(path.join(adminDir, "system-config.tsx"), systemConfigContent);
    } catch (_e) {
      console.warn("Admin system configuration page template not found");
    }

    // Access controls page (admin/access-controls.tsx). Lets administrators
    // grant/revoke CRUD operations per role and entity from the dashboard.
    try {
      const accessControlsContent = await this.component("src/routes/admin/access-controls.tsx");
      await fs.writeFile(path.join(adminDir, "access-controls.tsx"), accessControlsContent);
    } catch (_e) {
      console.warn("Admin access controls page template not found");
    }

    // Recursively copy admin subdirectories (table/$tableId/, window/$windowId/, etc.)
    const adminSubdirs = [
      { src: "src/routes/admin/table", dest: "src/routes/admin/table" },
      { src: "src/routes/admin/window", dest: "src/routes/admin/window" },
      { src: "src/routes/admin/element", dest: "src/routes/admin/element" },
      { src: "src/routes/admin/reference", dest: "src/routes/admin/reference" },
      { src: "src/routes/admin/rules", dest: "src/routes/admin/rules" },
      {
        // The screen ReportDesigner exists for. Without it the designer is
        // shipped and unreachable.
        src: "src/routes/admin/reports.$tableName.tsx",
        dest: "src/routes/admin/reports.$tableName.tsx",
      },
      {
        src: "src/routes/admin/workflow-definitions",
        dest: "src/routes/admin/workflow-definitions",
      },
    ];

    // One entry in that list is a single file, not a directory — the report
    // designer's route. Handing it to copyDirRecursive created the destination
    // first and only then failed reading the source, which left a *directory*
    // named `reports.$tableName.tsx` sitting in src/routes where the route file
    // should be: the designer was shipped and unreachable, exactly what the
    // entry above was added to prevent, and the only symptom was one warning
    // line reading "Admin subdir not found".
    for (const subdir of adminSubdirs) {
      const src = path.join(templateDir, subdir.src);
      const dest = path.join(outputDir, subdir.dest);
      try {
        const stats = await fs.stat(src);
        if (stats.isDirectory()) {
          await this.copyDirRecursive(src, dest);
        } else {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(src, dest);
        }
      } catch (_e) {
        console.warn(`Admin route template not found: ${subdir.src}`);
      }
    }
  }

  /**
   * Copy `public/` verbatim — everything in it is served from the app's own
   * origin. The webfonts live here rather than on a font CDN so a generated app
   * renders identically behind a corporate proxy, air-gapped, or in CI.
   */
  private async copyPublicAssets(outputDir: string): Promise<void> {
    try {
      await this.copyDirRecursive(
        path.join(this.resolvedTemplateDir, "public"),
        path.join(outputDir, "public")
      );
    } catch (e) {
      console.warn("Public assets not found, skipping:", (e as Error).message);
    }
  }

  private async copyDirRecursive(src: string, dest: string): Promise<void> {
    // Read the source before creating the destination. The other order left a
    // directory behind whenever the source could not be read — including when
    // it was a file all along, which is how an empty directory came to stand
    // where a route file belonged.
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Update/enhance configuration files created by TanStack Start CLI
   */
  private async updateConfigFiles(outputDir: string, context: any): Promise<void> {
    const templateDir = this.resolvedTemplateDir;

    // Update package.json with additional dependencies and custom config
    const packageJsonContent = await this.renderTemplate("package.json.hbs", context);
    await fs.writeFile(
      path.join(outputDir, "package.json"),
      typeof packageJsonContent === "string"
        ? packageJsonContent
        : JSON.stringify(packageJsonContent, null, 2)
    );

    // Update/generate TanStack Start config if template exists
    try {
      const tanStackConfigContent = await this.renderTemplate("app.config.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "app.config.ts"), tanStackConfigContent);
    } catch (_e) {
      console.warn("Custom app.config.ts template not found, keeping TanStack Start default");
    }

    // Update tailwind.config.js
    try {
      const tailwindContent = await this.component("tailwind.config.js");
      await fs.writeFile(path.join(outputDir, "tailwind.config.js"), tailwindContent);
    } catch (_e) {
      console.warn("Custom tailwind config template not found, keeping TanStack Start default");
    }

    // Copy postcss.config.js (required for Tailwind CSS processing)
    try {
      await fs.copyFile(
        path.join(templateDir, "postcss.config.js"),
        path.join(outputDir, "postcss.config.js")
      );
    } catch (_e) {
      console.warn("postcss.config.js template not found");
    }

    // Update tsconfig.json
    try {
      const tsconfigContent = await this.renderTemplate("tsconfig.json.hbs", context);
      await fs.writeFile(path.join(outputDir, "tsconfig.json"), tsconfigContent);
    } catch (_e) {
      console.warn("Custom tsconfig template not found, keeping TanStack Start default");
    }


    // Generate environment configuration for TanStack Start.
    //
    // VITE_API_URL is deliberately empty: the client then calls /api on its own
    // origin, which this server forwards to the API — the Vite proxy in
    // development, src/routes/api/$.ts once built. One origin means the session
    // cookie is an ordinary same-origin cookie, which is the only arrangement
    // that works over plain HTTP without configuring CORS for each host.
    const envLocalContent = `VITE_API_URL=
VITE_BACKEND_URL=${context.config.baseUrl}
VITE_MASTRA_URL=http://localhost:4111
# Dictionary sync over ElectricSQL. The client reads VITE_ELECTRIC_SYNC, not
# VITE_ELECTRIC_URL — the shape request goes to this application's own
# /api/v1/shape proxy, and it is the backend's ELECTRIC_URL that names the
# Electric server behind it.
#
# Left on: with no ELECTRIC_URL on the backend the proxy answers 503 once, the
# client records that this deployment has no Electric server, and every screen
# reads the dictionary over HTTP. Set it to false to skip that one discovery.
VITE_ELECTRIC_SYNC=true
# Where a built server forwards /api/*. Only read outside \`vinxi dev\`, which
# proxies through Vite instead.
BACKEND_URL=${context.config.baseUrl}
PORT=${context.config.frontendPort}
`;
    await fs.writeFile(path.join(outputDir, ".env.local"), envLocalContent);

    // Dockerfile for production container builds
    try {
      const dockerfileContent = await this.renderTemplate("Dockerfile.hbs", context);
      await fs.writeFile(path.join(outputDir, "Dockerfile"), dockerfileContent);
    } catch (_e) {
      console.warn("Frontend Dockerfile template not found, skipping");
    }
  }

  private async generateTestFiles(outputDir: string, context: any): Promise<void> {
    try {
      // Test setup
      const setupContent = await this.renderTemplate("test/setup.tsx.hbs", context);
      await fs.writeFile(path.join(outputDir, "test/setup.tsx"), setupContent);

      // Component tests
      const componentsTestContent = await this.renderTemplate(
        "test/components.test.tsx.hbs",
        context
      );
      await fs.writeFile(path.join(outputDir, "test/components.test.tsx"), componentsTestContent);

      // Vitest config
      const vitestContent = await this.renderTemplate("vitest.config.ts.hbs", context);
      await fs.writeFile(path.join(outputDir, "vitest.config.ts"), vitestContent);
    } catch (_e) {
      // Test templates not found, skip test generation
      console.warn("Unit test templates not found, skipping unit test generation");
    }

    // E2E tests are NOT generated here. They live in the project-level tests/
    // directory and run on bun:test — see BunE2ETestGenerator.
  }
}
