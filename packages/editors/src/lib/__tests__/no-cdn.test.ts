import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The modelling tool and the editors load nothing from a CDN: every library is
// an installed package, bundled by Vite and served by the application. A CDN
// puts a third-party host between a person and their own rules — the editor sits
// on a spinner behind a firewall or offline — and it did, once, for Monaco.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITORS_SRC = path.resolve(HERE, "../..");
const WEB_SRC = path.resolve(HERE, "../../../../web/src");

// Assembled rather than written out, so this file does not match itself.
const CDN_HOSTS = [
  "cdn.jsdelivr",
  "unpkg.com",
  "cdnjs.",
  "esm.sh",
  "cdn.skypack",
  "fonts.googleapis",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(tsx?|jsx?|css|html|md)$/.test(name) && !name.endsWith(".gen.ts") ? [full] : [];
  });
}

describe("no CDN", () => {
  it("is named anywhere in the editors' or the modelling tool's source", () => {
    const hits = [EDITORS_SRC, WEB_SRC].flatMap((root) =>
      sourceFiles(root).flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return CDN_HOSTS.filter((host) => text.includes(host)).map(
          (host) => `${path.relative(root, file)}: ${host}`
        );
      })
    );
    expect(hits).toEqual([]);
  });

  it("is left to Monaco's loader: it is handed the installed package", () => {
    // @monaco-editor/loader injects a script from jsdelivr when it has neither a
    // configured instance nor window.monaco. Configured, that branch is unreachable.
    const source = readFileSync(path.join(EDITORS_SRC, "lib/monaco-local.ts"), "utf8");
    expect(source).toMatch(/^import loader from "@monaco-editor\/loader";$/m);
    expect(source).toMatch(/^import \* as monaco from "monaco-editor";$/m);
    expect(source).toContain("loader.config({ monaco });");
  });
});
