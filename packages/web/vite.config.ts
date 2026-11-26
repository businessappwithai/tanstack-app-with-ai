import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The repo's env lives in one file at the monorepo root — README.md says
// `cp .env.example .env` there, and .env.example is the only template. But
// `bun run dev` is `bun --filter @appwithai/web dev`, which runs `vite dev`
// with cwd = packages/web, and Bun's automatic .env loading is per-process at
// cwd: it reads packages/web/.env (which does not exist) and does not export
// the root file's values to the child. So the SSR handlers ran with no
// DATABASE_URL, and the first write to the database — registering the first
// user — failed with "no PostgreSQL user name specified in startup packet".
//
// Load the root file here instead. `loadEnv(mode, dir, "")` reads .env,
// .env.local and .env.<mode> with no prefix filter, and the values land in
// process.env only — nothing is injected into import.meta.env, so a secret in
// .env cannot reach the client bundle. A variable already present in the real
// environment wins, which keeps deployed configuration authoritative.
const rootEnv = loadEnv(
  process.env.NODE_ENV ?? "development",
  path.resolve(__dirname, "../.."),
  ""
);
for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const config = defineConfig({
  server: {
    watch: {
      // /api/generate writes the generated app under
      // packages/web/generated-projects/<projectId> (see .gitignore). That is
      // inside Vite's watch root, so finishing a generation dropped hundreds of
      // files at once and triggered a full-page reload — which unmounted the
      // Generate step mid-run and threw away its logs and completion state.
      ignored: ["**/generated-projects/**"],
    },
    // Transform the rule editor in the background as soon as the server starts.
    // It is a lazy chunk over @gorules/jdm-editor (with antd) and Monaco — about
    // 11 MB of pre-bundled code — and Vite transforms a module on its first
    // request, so after every restart the first "New rule" sat on "Loading
    // editor…" while that happened. Warming the entry warms its static imports.
    warmup: {
      clientFiles: ["../editors/src/components/eml/GoRulesEditorPanel.tsx"],
    },
    // Setting `allow` replaces Vite's default — the workspace root — rather than adding to
    // it. `[".."]` alone (packages/) put the root node_modules out of reach, where bun keeps
    // @gorules/zen-engine-wasm: its .wasm answered 403, the decision table never left
    // Developer mode, and the operator palette and value pickers silently disappeared.
    fs: {
      allow: [searchForWorkspaceRoot(__dirname), path.resolve(__dirname, "..")],
    },
  },
  optimizeDeps: {
    // Native .node binaries and Node-only drivers can't be bundled by Rolldown — exclude them
    exclude: [
      "@mastra/fastembed",
      "@anush008/tokenizers",
      "@anush008/tokenizers-darwin-universal",
      "pg",
      "@appwithai/core",
      // Monaco workers must not be pre-bundled — Vite's ?worker handling creates the
      // wrapper with a default export, but optimizeDeps runs first and produces a plain
      // module with no default, so the worker import answers "no export named 'default'".
      "monaco-editor",
    ],
    // CJS interop: pre-bundle elkjs bundled JS so Vite handles it as ESM
    include: [
      "elkjs/lib/elk.bundled.js",
      // Monaco's workers, imported by packages/editors/src/lib/monaco-workers/.
      // The scan does not follow a `?worker` import into the worker, so these were
      // found only when a code box first started one — and finding a dependency
      // that late re-bundles and reloads the page under the person using it.
      "monaco-editor/editor/editor.worker",
      "monaco-editor/language/json/json.worker",
      "monaco-editor/language/typescript/ts.worker",
    ],
  },
  ssr: {
    // Treat workspace packages as Node.js externals so their dist/index.js
    // files are used directly instead of being re-processed by Vite SSR.
    // Without this, Vite SSR fails to resolve named exports (e.g. entityToBusEntity)
    // from subpath exports like @appwithai/core/types.
    external: ["@appwithai/core", "@appwithai/generator", "@appwithai/ai"],
  },
  resolve: {
    tsconfigPaths: true,
    // One Monaco. @gorules/jdm-editor depends on monaco-editor 0.52 but draws every
    // editor through @monaco-editor/react's loader, which takes the 0.57 instance
    // packages/editors/src/lib/monaco-local.ts puts on `window`. Its one direct
    // import is the MarkerSeverity enum — and resolving that from its own 0.52
    // pulled a second full Monaco into the rule editor's chunk: 4 MB more to
    // transform and about 95 more stylesheets on the first open.
    dedupe: ["monaco-editor"],
    alias: [
      // Replace @tanstack/start-api-routes@1.120 (Vinxi-based) with a Vite-compatible shim.
      // The original imports 'vinxi/routes' which doesn't exist in @tanstack/react-start@1.167+.
      // The shim also adds .update() to Route objects so routeTree.gen.ts works without error.
      {
        find: /^@tanstack\/start-api-routes$/,
        replacement: path.resolve(__dirname, "src/lib/start-api-routes-compat.js"),
      },
      { find: "#", replacement: path.resolve(__dirname, "src") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // `@appwithai/generator` is externalised for SSR and resolved from its
      // built `dist/index.js` for the client, which has no subpaths. The web
      // tsconfig only maps `@/*`, so a subpath import of the generator's pure
      // modules (the rules compiler, used by the enhance page) does not resolve
      // at runtime. Point it at the source, which is browser-safe.
      {
        find: /^@appwithai\/generator\/(.*)$/,
        replacement: path.resolve(__dirname, "../generator/src/$1"),
      },
      // The rule and workflow editors: one source, imported by path from packages/editors.
      {
        find: /^@appwithai\/editors\/(.*)$/,
        replacement: path.resolve(__dirname, "../editors/src/$1"),
      },
      // monaco-editor lives in packages/web/node_modules but packages/editors is
      // outside packages/web, so Vite cannot find it via normal node resolution.
      // Follow monaco-editor 0.57's exports map: "." -> esm/vs/index.js, "./*" -> esm/vs/*.js
      {
        find: /^monaco-editor$/,
        replacement: path.resolve(__dirname, "node_modules/monaco-editor/esm/vs/index.js"),
      },
      {
        find: /^monaco-editor\/(.+)$/,
        replacement: path.resolve(__dirname, "node_modules/monaco-editor/esm/vs/$1.js"),
      },
    ],
  },
  plugins: [
    // Console piping mirrors every browser console line into the server's, and the devtools
    // client mirrors that back into the browser — each pass prefixing another "[Server]".
    // One React warning on the Logic page grew the dev log to 690MB and the dev server to
    // 8GB within an hour. Nothing here reads the piped lines, so it is off.
    devtools({ consolePiping: { enabled: false } }),
    tailwindcss(),
    tanstackStart({
      tsr: {
        // Exclude API routes from the router tree — they're handled by TanStack Start's
        // API routing system separately and don't export a Route with .update().
        routeFileIgnorePattern: "^api",
      },
    }),
    viteReact(),
  ],
});

export default config;
