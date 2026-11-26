/**
 * Regression: `docker compose up --build` on a downloaded project died in the
 * frontend image with
 *
 *   ENOENT: ... /app/frontend/.vinxi/build/client/_build/.vite/manifest.json
 *   target frontend: failed to solve: ResourceExhausted: ... cannot allocate memory
 *
 * `oven/bun` ships no Node, so `vinxi build` (a `#!/usr/bin/env node` script)
 * ran on Bun, which ignores `--max-old-space-size`. Bundling Monaco and the
 * GoRules editor then outgrew a default Docker VM; the client build never wrote
 * its manifest and the SSR build failed on the missing file.
 *
 * Both build stages therefore run the bundler on real Node, with a heap the
 * reader can set (BUILD_HEAP_MB). Bun is copied in for the install. The runtime
 * stages stay on Bun.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs");

describe.each([
  ["frontend/Dockerfile.hbs", "builder"],
  ["Dockerfile.hbs", "build"],
])("%s", (file, stage) => {
  const source = readFileSync(join(ROOT, file), "utf8");

  it(`builds the front end in a Node stage (${stage})`, () => {
    expect(source).toMatch(new RegExp(`^FROM node:\\S+ AS ${stage}$`, "m"));
    expect(source).toContain("COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun");
  });

  it("runs vinxi under node with a configurable heap, never `bun run build`", () => {
    expect(source).toMatch(
      /NODE_OPTIONS=--max-old-space-size=\$\{BUILD_HEAP_MB\} node \.\/node_modules\/\.bin\/vinxi build/
    );
    expect(source).not.toMatch(/cd frontend && bun run build/);
  });

  it("keeps the runtime stage on Bun", () => {
    const last = source.split(/^FROM /m).pop() ?? "";
    expect(last.startsWith("oven/bun:1.4.4-alpine")).toBe(true);
  });
});

describe("Electric shapes do not share the page's connection pool", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it("passes VITE_ELECTRIC_PROXY_URL to the front-end build, defaulting to the API port", () => {
    expect(read("frontend/Dockerfile.hbs")).toContain(
      "ENV VITE_ELECTRIC_PROXY_URL=${VITE_ELECTRIC_PROXY_URL}"
    );
    expect(read("docker-compose.yml.hbs")).toMatch(
      /VITE_ELECTRIC_PROXY_URL: \$\{VITE_ELECTRIC_PROXY_URL:-http:\/\/localhost:\{\{project\.backendPort\}\}\/api\/v1\/shape\}/
    );
  });

  it("drops Electric's CORS headers but keeps access-control-expose-headers", () => {
    const src = read("backend/src/modules/electric/electric.controller.ts.hbs");
    const set = /const CORS_HEADERS = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? "";
    expect(set).toContain("access-control-allow-origin");
    expect(set).toContain("access-control-allow-credentials");
    expect(set).not.toContain("expose-headers");
  });
});
