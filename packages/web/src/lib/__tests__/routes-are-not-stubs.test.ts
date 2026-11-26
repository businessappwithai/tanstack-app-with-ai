/**
 * No route file may be the router's placeholder.
 *
 * TanStack Router's generator writes `Hello "/the/route"!` into a route file it
 * finds empty. A commit once carried the Enhance page as exactly that — 1,668
 * lines replaced by nine — and nothing failed until a browser opened the page.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = path.resolve(__dirname, "../../routes");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__") return [];
    return statSync(full).isDirectory() ? routeFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the route files", () => {
  it("are all real pages, none of them the generator's placeholder", () => {
    const stubs = routeFiles(ROUTES).filter((file) =>
      /<div>Hello "\/[^"]*"!<\/div>/.test(readFileSync(file, "utf8"))
    );
    expect(stubs.map((file) => path.relative(ROUTES, file))).toEqual([]);
  });
});
