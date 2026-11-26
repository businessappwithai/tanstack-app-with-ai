/**
 * Monaco, served by this application.
 *
 * The GoRules editor draws its code boxes — the Record schema, a function
 * node's source, the Simulator's request — with Monaco, and Monaco's loader
 * fetches itself from a public CDN unless an instance is already on `window`.
 * That put a third-party host between a person and their own rules: the boxes
 * sat on a spinner behind a firewall or offline. Importing it here makes Vite
 * bundle it and its workers beside the application.
 *
 * The loader is then told which Monaco to use with `loader.config({ monaco })`,
 * not left to find it on `window`. Its fallback, when it has neither, is a
 * script tag pointing at jsdelivr — reachable whenever an editor mounted before
 * this module ran. Configured, it has no CDN path at all. `@monaco-editor/loader`
 * holds that state and has no peer dependencies, so jdm-editor's copy of
 * `@monaco-editor/react` and this import share one instance of it.
 *
 * The workers are imported from the one-line entries in `monaco-workers/`, not
 * as `monaco-editor/editor/editor.worker?worker`. A query on a package subpath
 * reaches monaco's `exports` map, whose `"./*": "./esm/vs/*.js"` can swallow it:
 * on macOS the id came back as `editor.worker.js?worker.js`, Vite read
 * `worker.js` as no worker query at all, served the file as a plain module, and
 * the page failed with `does not provide an export named 'default'`. A relative
 * path never goes through `exports`, and each entry imports the worker with no
 * query, which resolves the same everywhere.
 *
 * Browser only. Import it from the same lazy chunk as the editor, never from a
 * module the server renders.
 */

import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
// @ts-expect-error — the language services, which have no type declarations of their own.
import * as jsonApi from "monaco-editor/language/json/monaco.contribution";
// @ts-expect-error — as above.
import * as typescriptApi from "monaco-editor/language/typescript/monaco.contribution";
import EditorWorker from "./monaco-workers/editor.worker?worker";
import JsonWorker from "./monaco-workers/json.worker?worker";
import TypeScriptWorker from "./monaco-workers/ts.worker?worker";

declare global {
  interface Window {
    monaco?: typeof monaco;
    MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
  }
}

if (typeof window !== "undefined" && !window.monaco) {
  // Monaco 0.55 moved the TypeScript and JSON language APIs out of
  // `monaco.languages`. The GoRules editor still reads them from there (a
  // function node's editor starts with `languages.typescript.javascriptDefaults`),
  // so they are put back where it looks.
  const languages = monaco.languages as unknown as Record<string, unknown>;
  languages.typescript ??= typescriptApi;
  languages.json ??= jsonApi;

  window.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === "json") return new JsonWorker();
      if (label === "typescript" || label === "javascript") return new TypeScriptWorker();
      return new EditorWorker();
    },
  };
  window.monaco = monaco;
  loader.config({ monaco });
}

export { monaco };
